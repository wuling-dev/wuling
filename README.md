# 武陵 DevOps（Rust 重写）

直接实现 `plans/plans.md` 的第一阶段原型，不引入 spec-driven 工作流。自有代码许可见 `License`，品牌图稿只按 `assets/BRAND-USAGE.md` 授权使用；第三方清单见 `third-party-license.md`。

## 启动

需要 Rust、系统 Git、Node（见 `.nvmrc`）和项目指定的 pnpm。

先按 [数据库说明](deploy/DATABASE.md) 配置 PostgreSQL、运行迁移、本机引导账号和原型导入。
在项目根目录运行后端（数据库凭据从本地环境或 `.pgpass` 提供，不写入仓库）：

```sh
WULING_WEB_ORIGIN='http://localhost:3000' cargo run -p wuling-server
```

另一个终端在 `frontend/`：复制 `.env.example` 为 `.env`，执行 `pnpm dev`。生产构建：`pnpm build`，然后 `pnpm start`。两个服务默认只监听 loopback；公开部署必须在前方配置 HTTPS、访问控制、限流和备份。**本版本是单进程开发原型，不适合直接暴露为多租户生产服务。**

共享管理员令牌已移除；网页 API 使用 HttpOnly JWT Cookie 和可撤销刷新链，匿名只能读公开仓库。
启动须从外部持久密钥管理器注入 `WULING_JWT_KEYS`，配置格式、迁移和轮换见数据库说明。
登录/成员/PAT 前端尚待恢复，旧「应用管理员令牌」界面不再有效。
私有仓库直达 SSR 认证尚未交付。认证 API 见数据库说明。

元数据保存为 PostgreSQL，Git 默认位于 `data/repos/<id>.git`；可设置 `WULING_DATA_DIR`。
运行时不再读写 `state.json`。备份必须同时覆盖数据库和 Git，暂不支持多个实例共享 Git 目录。

PostgreSQL 数据层和离线原型导入工具正在按 `restore-core-devops` 恢复，分别位于独立的
`wuling-storage` / `wuling-import` crate。连接、迁移和隔离验收见
[数据库说明](deploy/DATABASE.md)。HTTP 已切换到 PostgreSQL；历史协作记录暂时只读。

## 当前功能与边界

| 模块 | 已实现 | 尚未实现 |
| --- | --- | --- |
| Repo | 创建公开/私有裸仓库、分支/文件列表、文本读取 | HTTP/SSH clone/push、导入、权限成员、提交浏览 |
| Issue | 导入历史记录只读列表 | 创建/编辑/状态恢复、评论、标签、指派 |
| Merge Request | 导入历史记录只读列表 | 创建/合并恢复、diff/review、分支保护 |
| Pipelines | 导入历史状态只读列表 | 真实执行、隔离 Runner、日志流、自动触发；历史成功不代表真实 CI |
| Wiki | 导入历史记录只读列表 | 写入恢复、Markdown 渲染、历史版本 |
| Insight | 实时汇总 Issue/MR/流水线状态/Wiki 数量 | 提交趋势、耗时等高级统计 |

向新建仓库写入代码，目前需服务主机本地 Git：`git push /absolute/path/to/data/repos/<id>.git main`。
历史协作写接口及合并返回 503，待领域迁移后恢复；不再通过旧共享令牌修改数据。
尚无 OAuth、旧 Go 数据迁移、真实构建执行或完整 Git 托管协议，不能视为旧版功能对等替换。

## 渲染、SEO 与构建适配

- 首页与仓库概览 SSR；代码、Issue、MR、流水线、Wiki、Insight 工作区明确 `ssr: false`，客户端导航交互。
- `frontend/.env` 的 `WULING_INDEXABLE` 默认 false；公开索引部署还应设置真实 `WULING_PUBLIC_ORIGIN`，然后重新构建。标题、description、canonical、robots meta；生产服务器提供 robots.txt 和 X-Robots-Tag。noindex 不是访问控制。
- 原生适配器在 `frontend/packages/nasti-tanstack-start/index.ts`，直接实现 Nasti environment、virtual module、dev middleware 与生产 manifest 汇总，不导入或包装 TanStack Vite 插件。
- 使用显式路由树；只支持当前项目所需的 Start SSR/SPA 与 Rust REST 模式，不提供 `createServerFn` 编译、文件路由自动生成或通用插件兼容保证。
- 两个恢复的主题保持原有 token；修正品牌主题 dark selector；直接使用授权 SVG。

## 验证与依赖归属

开发、构建和单实例运行入口见 [部署说明](deploy/README.md)：
`sh scripts/dev.sh`、`sh scripts/build.sh`、`sh scripts/start.sh`。
`sh scripts/check.sh` 串行执行格式、Clippy、Rust 测试、ESLint、TypeScript 和前端测试。
Nix 开发 shell / app 入口见 `flake.nix`（尚需在装有 Nix 的机器上验证并生成锁文件）。
功能恢复批次与 gRPC / 协作工作区边界见 [开发计划](plans/plans.md)。

```sh
cargo test
node scripts/licenses.mjs
```

在 `frontend/` 运行 `pnpm typecheck`、`pnpm test`（Lightning）与 `pnpm build`。第三方依赖变动后重新生成许可证清单；脚本保留能找到的上游根许可/NOTICE，分发原生二进制前仍需审核 vendored 库的许可。

后端通过系统 `git` 执行仓库操作，不链接 libgit2；Rust 构建无需设置 `CMAKE_POLICY_VERSION_MINIMUM` 兼容参数，运行服务时仍需安装 Git。
