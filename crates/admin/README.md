# 本机运维工具

包名 `wuling-admin`，与未来类似 `gh` 的远程用户客户端 `crates/cli` 分离。
本工具读取本机数据库连接，**不监听端口，不提供远程引导接口**。

## Commands

```sh
export WULING_DATABASE_URL='host=127.0.0.1 port=55432 dbname=wuling'
cargo run -p wuling-admin --bin wuling-db -- migrate
cargo run -p wuling-admin -- bootstrap admin
cargo run -p wuling-admin -- create-user admin alice
```

交互终端使用隐藏密码提示；自动化调用从标准输入逐行读取密码。
`bootstrap` 读取一个管理员密码；`create-user` 依次读取管理员密码、新用户密码。
不要把真实密码放到命令行参数、脚本、仓库文件或共享日志中。
首次引导仅在尚无管理员时可用；停用已有管理员不会重新开放引导。
创建用户需验证启用的管理员凭据。
本机账号创建不代表网页会话、PAT 或成员权限已经交付。

## Verification

`sh scripts/check-postgres.sh` 会创建独立的空数据库，运行真实命令进程的验收：
并发引导仅一个成功、重复引导拒绝、管理员创建用户、错误密码与普通用户越权拒绝、
用户名大小写冲突、弱密码拒绝、独立 Argon2id 盐、停用管理员后无法创建用户或重新引导。
测试还检查输出不包含密码或哈希。

也可对一个**空的、可丢弃的隔离数据库**单独运行：

```sh
WULING_TEST_DATABASE_URL='host=127.0.0.1 port=55432 dbname=admin_test' \
  cargo test -p wuling-admin --test postgres -- --ignored
```

服务端另有公开注册和远程引导拒绝测试：

```sh
sh scripts/check-postgres.sh
```

导入命令和备份要求见 [数据库说明](../../deploy/DATABASE.md)。
原命令 `cargo run -p wuling-server --bin wuling-db` 已迁移为
`cargo run -p wuling-admin --bin wuling-db`；不在服务端保留重复运维入口。

## Boundaries

- `admin`：本机运维命令及密码输入。
- `iam`：身份认证、密码验证与授权规则。
- `storage`：SQL、数据访问及事务迁移。
- `import`：原型导入。
- `server`：HTTP API，不直接承载本机引导命令。
- `cli`：未来通过 HTTP API 访问服务，不直接连库。
