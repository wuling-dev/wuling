# 原型 JSON 导入

`wuling-import` 是独立的离线导入 crate；不依赖 Axum，不调用 Git，不修改输入文件。
仅支持当前 Rust 原型格式，不接受旧 Go 数据库。

- 导入前要求源 JSON 的独立备份且逐字节一致。
- 归属表为 `{"仓库ID": 用户ID}`，必须恰好覆盖全部仓库；用户必须已存在且启用。
- 仓库与协作记录保留 ID、内容、可见性和原状态；未知作者为 `historical_import`，不归到新管理员。
- 原型流水线仅作为历史记录保存，不将原型 `success` 当作真实 CI 检查。
- 整次导入在单一事务中提交；连接中断回滚全部数据。
- 相同快照与归属表重试返回 `AlreadyImported`，不同快照或映射拒绝覆盖。
- 只接受空目标仓库集合，防止覆盖在线数据；迁移时必须停止旧服务写入。

## Verification

在空的、可丢弃的独立 PostgreSQL 数据库运行：

```sh
WULING_TEST_DATABASE_URL='host=127.0.0.1 port=55432 dbname=wuling_import_test' \
  cargo test -p wuling-import --test postgres -- --ignored
```

测试通过数据库触发器主动断开连接，验证中途写入回滚、重连重试、重复导入、
错误备份、非法归属、ID/历史作者保留和源文件不变。测试需要隔离库内的建表与终止自身连接权限。
普通 `cargo test` 不会代替这项真实数据库验收。
