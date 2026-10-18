# 单实例部署与开发

当前仍是原型，不是多租户生产版。以下脚本不安装系统包、不配置公网、
不自动迁移或删除数据，也不创建或保存管理员密钥。

## 开发

使用 `.nvmrc` 的 Node 和 `frontend/package.json` 的 pnpm 版本。
先在 `frontend` 执行 `pnpm install --frozen-lockfile`。
按需复制 `frontend/apps/web/.env.example` 为 `frontend/apps/web/.env`，不要提交真实环境文件。

TypeScript 7 的 `tsc` 由 `@typescript/native` 别名提供；`typescript` 别名指向
官方 TS 6 兼容 API，仅供 typescript-eslint 使用。这是官方建议的并行配置，
不是把项目类型检查降级到 TS 6。

先按 [数据库说明](DATABASE.md) 迁移、引导账号并按需导入原型数据。
从环境注入 `WULING_DATABASE_URL`、持久 `WULING_JWT_KEYS` 和 `WULING_WEB_ORIGIN`（开发如 `http://localhost:3000`），然后：

```sh
sh scripts/dev.sh
```

该入口启动前后端，任一服务退出后停止另一服务。退出后需检查端口是否释放：
包管理器/开发服务器可能产生额外子进程，不作为生产进程管理器使用。
Git 操作使用系统 Git，不链接 libgit2。

## 构建与运行

```sh
sh scripts/check.sh
sh scripts/build.sh
sh scripts/start.sh
```

构建阶段需要联网拉取锁定依赖；它不是离线/可复现的 Nix derivation。
不要在构建阶段注入管理员令牌。SEO 的 `WULING_INDEXABLE` 和
`WULING_PUBLIC_ORIGIN` 是构建配置，修改后重建；默认禁止索引。
输出位于 `frontend/apps/web/dist`；应用只在 landing、系统文档和公开 README/元数据使用 SSR。
其他页面为 noindex SPA。Swagger 位于 `/api/docs/`，由前端的同源 API 代理转发。

运行阶段注入 `WULING_DATABASE_URL`、持久 `WULING_JWT_KEYS`、HTTPS 的 `WULING_WEB_ORIGIN` 和绝对路径 `WULING_DATA_DIR`。后端默认监听
`127.0.0.1:4000`，前端默认监听 `127.0.0.1:3000`。
由同机 HTTPS 反向代理转发到前端；前端代理 `/api/` 到后端。
不要直接把两个服务绑定公网。部署在专用低权限用户下，限制目录权限、
请求体大小和请求速率。`start.sh` 是前台入口，长期运行应由系统服务管理并重启。

升级前停止写入，同时备份 PostgreSQL 与 `WULING_DATA_DIR` 整个目录（原 JSON 备份和裸 Git 仓库）；
在隔离目录验证备份可恢复后再升级。不得多个实例共享该目录。

## Nix

安装 Nix 并启用 flakes 后，从仓库根目录：

```sh
nix develop
nix run .#dev
nix run .#check
nix run .#build
nix run .#start
```

这些 app 在开发 shell 中执行同一组脚本，不会自动部署到远程机器。
首次解析会生成 `flake.lock`；应审查并提交后再作为团队固定环境使用。
`nixpkgs` 提供的 Node/pnpm/Rust 可能与项目指定版本不同，使用前需核对，
尤其 pnpm 应遵循 `packageManager` 字段。尚未提供 NixOS 服务模块和离线构建包。

## 当前验证记录

在 macOS / Node 24.15.0 / pnpm 12.11.2 下验证：

- `sh scripts/check.sh`：Rust 格式、Clippy、workspace 单元测试、API 契约漂移、
  Prettier、ESLint、TS 7、生产构建和 15 个 Lightning 测试通过。
- `sh scripts/check-postgres.sh`：独立数据库中的迁移、导入、账号、成员与 JWT 集成测试通过。
- `sh scripts/check-web.sh` 与 `WULING_WEB_TEST_INDEXABLE=true sh scripts/check-web.sh`：
  真实 Rust API、生产前端代理与 Chromium；覆盖权限、双标签续期、账号隔离、
  真实 Git README、公开 SSR / 私有 SPA、索引头、sitemap 与 Swagger。
- `pnpm install --frozen-lockfile` 通过，新增依赖已更新许可证清单。

构建仍有上游 `use client` 指令警告；浏览器无运行错误，构建测试阻止 Node storage 进入客户端。
截图为人工审阅，没有像素差分基线。Firefox、WebKit、Nix、部署 TLS 与备份恢复未验收。
