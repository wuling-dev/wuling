# PostgreSQL 数据层

`wuling-storage` 独立于 HTTP 服务，集中维护数据库连接、版本迁移，以及身份和仓库数据访问。
它不依赖 Axum，也不启动 API；数据库故障可以单独复现，不必启动前端或服务端。

## Layout

- `src/lib.rs`：本机数据库连接和事务化版本迁移；并发迁移通过事务级 advisory lock 串行执行。
- `src/identity.rs`：身份数据访问，对外模型不包含密码哈希。
- `src/repository.rs`：仓库数据访问。
- `migrations/`：只追加、不改写已应用版本的 SQL；检测到版本或内容不一致时拒绝迁移。
- `tests/postgres.rs`：真实 PostgreSQL 验收，包括并发与重复迁移、事务回滚和迁移内容变更检测。

## Verification

普通编译与静态检查：

```sh
cargo test -p wuling-storage
cargo clippy -p wuling-storage --all-targets -- -D warnings
```

普通测试命令不会执行需要数据库的测试；数据库验收必须显式执行。
准备一个**空的、可丢弃的隔离数据库**，然后运行：

```sh
export WULING_TEST_DATABASE_URL='host=127.0.0.1 port=55432 dbname=wuling_storage_test'
cargo test -p wuling-storage --test postgres -- --ignored
```

该测试会在指定数据库中创建表并修改迁移记录，禁止指向生产或共享数据库。
连接函数目前仅允许本机 Unix socket 或 loopback，未实现远端 TLS 连接。

## Migration command

运维入口仍由服务端包提供，不将命令行解析放进数据层：

```sh
export WULING_DATABASE_URL='host=127.0.0.1 port=55432 dbname=wuling'
cargo run -p wuling-server --bin wuling-db -- migrate
```

迁移命令不会读取或改写原型 `state.json`，也不会自动切换 HTTP 服务的数据来源。
JSON 显式导入与运行时切换需按后续任务实施，不能把建表成功视为功能迁移完成。
