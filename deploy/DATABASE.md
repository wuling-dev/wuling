# PostgreSQL 迁移与隔离验收

## Current boundary

数据层已拆为 `wuling-storage`，原型导入为 `wuling-import`。
`crates/admin` 的 `wuling-db` 是离线运维入口，与 `crates/cli` 的远程客户端分开；
HTTP 服务已切到 PostgreSQL，**不会读取或写入 JSON，也不再接受共享管理员令牌**。
历史协作记录暂时只读；后续领域任务完成前，不应将新库视为可上线的完整替代。
这里只迁移当前 Rust 原型，不兼容旧 Go 数据库。

## Local and Nix

需要 Rust、系统 Git 和 PostgreSQL 18 工具（`initdb`、`pg_ctl`、`createdb`、`psql`）。
普通环境将这些工具加入 PATH；Nix 环境：

```sh
nix develop
sh scripts/check-postgres.sh
```

Nix shell 包含 `postgresql_18`，不自动启动数据库，不改写全局 PostgreSQL 配置或系统服务。
没有 Nix 的机器可直接执行同一脚本。已在 aarch64-darwin 的 Nix shell 中执行同一脚本通过；
其他平台尚未验证。本次通过 `--no-write-lock-file` 使用 nixpkgs 提交
`55bfb4d7437bd4e09ab7cba58a43bd68eb310044`，不代表已建立锁定的发布环境。

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
cargo run -p wuling-admin --bin wuling-db -- migrate
```

凭据从本地环境或 `.pgpass` 提供，不写入仓库或共享命令记录。
当前连接只支持本机 loopback/Unix socket，远端 TLS 连接尚未实现。
生产 PostgreSQL 必须配置认证、最小权限、网络限制与备份，不使用验收集群。

归属表 `owners.json` 将每个原仓库 ID 显式映射到新库已有的启用用户 ID：

```json
{"10": 1, "12": 2}
```

先通过本机运维工具创建账号，再核对映射中的 ID；不能默认将所有历史记录归到管理员：

```sh
cargo run -p wuling-admin -- bootstrap admin
cargo run -p wuling-admin -- create-user admin alice
```

密码使用隐藏提示输入，命令输出账号 ID。不要把验收脚本中的测试用户 SQL 用于正式账号初始化。
首次引导不能重复执行，具体约束见 [本机运维工具](../crates/admin/README.md)。

```sh
cargo run -p wuling-admin --bin wuling-db -- import \
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
切换服务前必须完成迁移、引导、归属导入及内容核对。回退需停止新写入后恢复完整备份，
不得让旧版本读取新格式；备份不能自动保留切换后的新增数据。

## Runtime cutover

此阶段已将 HTTP 的仓库列表、仓库详情、Git 浏览及历史协作读取切换为 SQL。
登录使用本机工具建立的账号，仓库按公开性、所有者或当前成员判断权限；
管理员身份不自动获得所有私有仓库读取权。创建仓库需要登录，所有者为当前用户。
历史 Issue/MR/流水线/Wiki 创建、编辑和合并接口返回 503 及只读原因，不再改写 JSON。
流水线历史成功状态不代表真实执行或可用合并门禁。Git 对象仍使用原 `repos/<id>.git`。
创建仓库时 Git 与 SQL 无跨存储事务，失败可能遗留未关联的裸目录；需核对后处理，
服务不会自动删除或覆盖已有 Git 目录。

```sh
export WULING_DATA_DIR="$PWD/data/original"
export WULING_WEB_ORIGIN='http://localhost:3000'
# 保留上文已设置的 WULING_DATABASE_URL，并按下文配置 WULING_JWT_KEYS。
cargo run -p wuling-server
```

`WULING_WEB_ORIGIN` 必须与浏览器访问前端的 origin 精确一致，不带尾斜杠。
生产使用 HTTPS；只允许本机 localhost/127.0.0.1 以 HTTP 开发。
网页 access JWT 默认最多 15 分钟，Cookie 为 HttpOnly、SameSite=Strict，HTTPS 下附加 Secure；
刷新凭据仅存 SHA-256 摘要。所有写请求（包括登录/刷新/退出）必须携带匹配的 Origin。
前端 `/api/` 代理保留 Cookie、Origin 与 Set-Cookie；不要让反向代理改写 Origin。

认证 API：

- `POST /api/auth/login`：JSON `username/password`，设置 JWT 及刷新 Cookie；JSON 只返回用户公开字段。
- `GET /api/auth/me`：返回当前用户公开字段，过期/撤销凭据返回 401。
- `POST /api/auth/refresh`：只使用刷新 Cookie，成功返回 204 并轮换两枚 Cookie；无效/重放返回 401 并清除两枚 Cookie。
- `POST /api/auth/logout`：撤销当前会话并清除两枚 Cookie；access 已过期时仍可凭刷新 Cookie 退出。
- `POST /api/users/<id>/disable`：仅启用管理员可操作；停用并撤销该用户全部会话。

响应使用 `private, no-store`；网页登录、成员与 API Token 页面已接入 Cookie API，
入口及真实浏览器验收见 [前端说明](../frontend/README.md)。私有概览直达 SSR 认证仍待后续任务。
旧「应用管理员令牌」入口已移除，不再保留共享令牌操作界面。
测试由 `sh scripts/check-postgres.sh` 中独立 `server_test` 库覆盖：
过期/退出/停用、跨站写入、旧令牌失效、成员移除即时拒绝、
历史只读与 JSON 不变、重建 App 后 SQL 数据及会话继续有效。

## JWT cutover and rotation

停服务、备份数据库及 Git 后，运行 `cargo run -p wuling-admin --bin wuling-db -- migrate`。
迁移 0005 清除旧不透明会话，并建立独立网页会话和刷新链表；所有旧网页 Cookie 需要重新登录。
API Token 不受影响。启动缺少新表或签名配置会失败，不自动迁移，也不回退旧 Cookie。
回退必须恢复匹配的数据库与服务版本；不可把旧验证逻辑当作临时旁路。

从外部持久密钥管理器注入 `WULING_JWT_KEYS`，结构如下（占位符不可直接使用）：

```json
{
  "active_kid": "web-2026-10",
  "keys": [
    {"kid": "web-2026-10", "secret_hex": "<密码管理器生成并持久保管的32–64字节随机密钥的十六进制编码>"}
  ]
}
```

不把真实值写进仓库、前端环境文件、构建产物、命令参数或共享日志，不在服务启动时自动生成。
HS256 为固定算法；`kid` 只能命中配置内密钥，不按 JWT 提供的 URL 下载 key。
`iss` 为 `WULING_WEB_ORIGIN`，`aud` 固定 `wuling-web`；变更 origin 后旧 JWT 不能使用，
仍可通过匹配新来源的有效刷新 Cookie 续期。JWT 只包含用户 ID、会话 ID、受众、签发者和时间，
不固化成员角色；每次查询关联会话撤销状态、绝对期限和当前账号状态。

密钥轮换时保留最多一个旧验证密钥，添加绝对 Unix 秒 `verify_until`，
截止不得晚于配置加载时起 900 秒；当前签名密钥不得设置此字段。
例如将新 `active_kid` 和新密钥注入，旧项附截止时间并重启；在同一绝对截止后移除旧项。
部署准备时间也计入窗口，别在每次重启时重新延长截止。旧项即使仍在配置中，截止后也不验签。
重启不会丢失会话或刷新链；不更换密钥时既有有效 Cookie 继续可用。

`WULING_WEB_SESSION_DAYS` 为刷新链绝对期限，默认 30 天，支持 1–90 天，只影响新会话。
`wuling_session` 路径为 `/`，`wuling_refresh` 路径限制为 `/api/auth`，均无 Domain 属性；
前端只发 Cookie，不读写 JWT 原文。JWT 不作为 OAuth Bearer 或 API Token 接受。
刷新成功不延长链的绝对期限；旧摘要留存用于重放检测，会话清理时才可级联清理。
同一旧刷新 Cookie 并发使用时，最多一个事务成功，其余请求触发重放撤销，成功响应中的 JWT
也随链撤销失效。响应丢失后不要重试旧刷新值；应重新登录。

UI 在同标签页和多标签页之间通过 Web Locks 统一协调续期，先暂停其他认证请求，再轮换和重试一次；
刷新失败清理 Query/路由私有状态并重新登录，不循环重试。该协调入口由任务 2.5 的浏览器联测覆盖，
当前后端不会把 JWT 或刷新原文交给 JavaScript。HttpOnly 不能阻止 XSS 代发请求。

`jwt_test` 隔离数据库覆盖 Cookie 安全属性、轮换与摘要、重放/并发撤销、绝对期限、
跨站刷新/退出、无 access Cookie 续期/退出、停用再启用不复活、重建 App 会话持续有效。
IAM 单测覆盖错误签名/算法/受众/签发者/有效期/缺失字段、未知 kid 和有界旧密钥窗口。

## Repository members

- `GET /api/repos/<id>/members`：仅维护者可列出成员和所有者。
- `PUT /api/repos/<id>/members/<user_id>`：JSON `{"role":"reader"}`，新增或更新成员；
  支持 `reader`、`developer`、`maintainer`。
- `DELETE /api/repos/<id>/members/<user_id>`：移除成员，后续请求立即重新判定权限。

以上成员管理操作需要仓库维护者；写入必须携带有效会话及匹配的 Origin。
Reader 只读，Developer 为后续协作/Git 写入角色，Maintainer 可管理成员。
所有者隐含 Maintainer，不允许通过成员接口降权或移除；不提供所有权转移。
新增成员必须是启用用户；不接受自定义或管理员角色。成员变更按仓库串行化并在锁后复查权限。
`member_test` 隔离库覆盖角色变更、自提升拒绝、跨仓库拒绝、非法角色/用户、
保护所有者及移除后私有仓库、Git 浏览和协作读取立即失效。

## Personal access tokens

升级服务前重新执行 `cargo run -p wuling-admin --bin wuling-db -- migrate`，应用新增 PAT 表。

- `POST /api/auth/tokens`：JSON `{"name":"workstation","scope":"read","expires_in_days":30}`。
  `scope` 仅支持 `read`、`write`，有效期为 1–365 天，名称最长 80 字节。
  仅创建响应包含完整 `token`，请存入本地凭据管理器，不写进仓库或共享日志。
- `GET /api/auth/tokens`：仅返回当前用户自己的 ID、名称、scope 与到期 Unix 秒，不含原文或摘要。
- `DELETE /api/auth/tokens/<id>`：幂等撤销当前用户持有的令牌，不能撤销他人的令牌。

这些管理接口只接受网页会话；写请求仍要求匹配 Origin。PAT 不能创建更多 PAT、
修改成员或停用用户。仓库读取 API 可使用 `Authorization: Bearer <PAT>`。
仅存储 256 位随机令牌的 SHA-256 摘要；不提供找回原文接口。
Read 上限为 Reader，Write 上限为 Developer，实际权限与当前成员角色取交集；
Write 不能越过维护者门禁，成员移除、降权、停用、到期和撤销均在后续使用时检查。
Git Basic/Smart HTTP 接入属于任务 3.1，当前尚不能用 PAT 执行远程 clone/push。

隔离验收覆盖只返回一次、摘要长度、read/write scope 与角色交集、跨仓库拒绝、
PAT 不可管理令牌、降权/移除失效、跨账号撤销无效、正常撤销、到期及非法有效期。
