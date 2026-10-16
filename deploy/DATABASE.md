# PostgreSQL 迁移与隔离验收

## Current boundary

数据层已拆为 `wuling-storage`，原型导入为 `wuling-import`。
`wuling-db` 是离线运维入口；当前 HTTP 原型仍读写 JSON，**设置数据库连接或导入成功不会自动切换 API**。
认证、各领域运行时迁移完成前，不应将新库视为可上线的完整替代。
这里只迁移当前 Rust 原型，不兼容旧 Go 数据库。

## Local and Nix

需要 Rust、系统 Git 和 PostgreSQL 18 工具（`initdb`、`pg_ctl`、`createdb`、`psql`）。
普通环境将这些工具加入 PATH；Nix 环境：

```sh
nix develop
sh scripts/check-postgres.sh
```

Nix shell 包含 `postgresql_18`，不自动启动数据库，不改写全局 PostgreSQL 配置或系统服务。
没有 Nix 的机器可直接执行同一脚本；Nix 入口仍需在有 Nix 的机器上单独验证。

`sh scripts/check-postgres.sh` 创建工作区 `data/` 下独立的临时集群，仅监听
`127.0.0.1:55432`，禁用 Unix socket，避免 macOS 长路径限制。端口冲突时先排查占用，
或显式设置 `WULING_TEST_POSTGRES_PORT`；不要停止不属于本次验收的数据库。
脚本在退出时关闭自己启动的集群，保留日志、快照、备份和引用核对文件。
它使用只适用于隔离测试的 trust 认证；禁止复制为生产配置。

脚本依次验证：

1. 空库、并发、重复迁移与篡改拒绝。
2. 导入中途主动断开数据库连接，回滚并重试。
3. CLI 两次迁移、两次导入，数据库计数为 `1|1|1`，不重复创建。
4. 真实裸仓库的引用、HEAD、对象完整性及整个原数据目录与备份一致。

## Offline import

先停止旧服务写入，再备份**完整数据目录**，包括 JSON 和 `repos/`。备份应存放于独立位置，
生产部署使用独立介质并验证可恢复；不能只复制 JSON。

```sh
# 路径替换为已停止写入的原型目录及新的备份目录。
cp -R data/original data/prototype-backup
diff -r data/original data/prototype-backup
```

为新实例创建独立数据库，配置本机连接：

```sh
export WULING_DATABASE_URL='host=127.0.0.1 port=55432 dbname=wuling'
cargo run -p wuling-server --bin wuling-db -- migrate
```

凭据从本地环境或 `.pgpass` 提供，不写入仓库或共享命令记录。
当前连接只支持本机 loopback/Unix socket，远端 TLS 连接尚未实现。
生产 PostgreSQL 必须配置认证、最小权限、网络限制与备份，不使用验收集群。

归属表 `owners.json` 将每个原仓库 ID 显式映射到新库已有的启用用户 ID：

```json
{"10": 1, "12": 2}
```

用户创建入口属于身份任务，尚未交付；不要把验收脚本中的测试用户 SQL 用于正式账号初始化。
待身份引导可用后，先创建账号，再核对映射中的 ID；不能默认将所有历史记录归到管理员。

```sh
cargo run -p wuling-server --bin wuling-db -- import \
  data/original/state.json data/prototype-backup/state.json data/owners.json
```

导入要求空的目标仓库集合；备份须与源 JSON 一致，归属表须恰好覆盖全部仓库。
所有元数据同事务提交，失败后可使用相同输入重试；成功后相同输入返回 `AlreadyImported`，
不同快照或映射拒绝覆盖。历史作者标记为 `historical_import`，原型流水线不作为真实 CI 检查。
导入保留 Git 磁盘布局和对象，不复制、重写或更新引用。

导入前后逐仓库记录 `for-each-ref` 和 `symbolic-ref HEAD`，并比较：

```sh
git --git-dir=data/original/repos/10.git for-each-ref --format='%(refname) %(objectname)'
git --git-dir=data/original/repos/10.git symbolic-ref HEAD
git --git-dir=data/original/repos/10.git fsck --full
```

SQL 数量分别核对 `repositories`、`historical_items` 和原 JSON 的 `repos/items`。
还需核对仓库 ID、归属、可见性、标题正文、原状态；不要以命令退出码代替内容验收。
切换服务前必须完成后续身份和运行时任务。回退需停止新写入后恢复完整备份，
不得让旧版本读取新格式；备份不能自动保留切换后的新增数据。
