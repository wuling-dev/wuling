# Frontend workspace

`frontend/` 是纯 pnpm workspace 根目录，不承载应用。共用一份锁文件、ESLint、
Prettier 与 TypeScript 基础配置；每个包声明自己的依赖和公开导出。

## Packages

- `apps/web`（`@wuling/web`）：React / HeroUI 应用、显式路由、生产 HTTP 服务。
- `packages/api-client`（`@wuling/api-client`）：OpenAPI 生成类型、typed fetch 客户端、
  Cookie 会话请求协调；不依赖 React。
- `packages/nasti-tanstack-start`：私有包 `@wuling/nasti-tanstack-start`，
  通过 `workspace:*` 引用，直接导出 TypeScript 源码，由 Nasti 和测试工具处理。
  不发布到公共注册表，不增加额外预构建步骤。

包之间通过包名及 `exports` 引用，不跨目录导入内部文件。
新增共享包放到 `packages/*`，声明自己的依赖、导出和类型检查脚本。
`themes/` 保留两套既有主题 token。无需 Turborepo 或额外预构建共享包。

## Commands

在 `frontend/` 执行：

```sh
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
pnpm dev
pnpm api:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm start
```

`pnpm typecheck` 使用 TypeScript 7，包含测试、应用和 workspace 子包。
`typescript` 的 TS 6 兼容 API 别名供 ESLint 使用，编译器由 `@typescript/native` 别名提供。
`pnpm format` 使用 Prettier：2 空格、分号、单引号、100 列、尾逗号。
ESLint 阻挡错误 Hooks、effect/渲染中的同步状态更新、嵌套组件、数组下标 key、
不稳定默认 props、悬空 Promise 与跨包内部导入。负面夹具验证规则确实生效。
`pnpm test` 仍先构建再执行 Lightning 的适配器、SSR 和生产 HTTP 测试。
另外覆盖账号请求隔离、续期串行化、失败不循环重试和迟到私有响应丢弃。
单独检查适配器：

```sh
pnpm --filter @wuling/nasti-tanstack-start typecheck
```

## API 契约

Rust `crates/server/src/main.rs` 的 `utoipa::path` 同时注册 HTTP 路由和 OpenAPI；
`dto.rs` 的实际响应类型生成 schema。不另写一份前端接口模型。

```sh
pnpm api:generate  # 无需数据库；导出 Rust 契约并生成 TypeScript
pnpm api:check     # 比较生成内容；漂移即失败，不改文件
```

提交 `packages/api-client/openapi.json` 与 `src/schema.d.ts`，不要手改。
应用只能通过 `@wuling/api-client` 的类型化方法访问业务 API。
运行后端后，`/api/openapi.json` 提供文档，`/api/docs/` 提供内嵌 Swagger UI。
写请求要求精确 Origin；Cookie 是 HttpOnly，不能在 Swagger 中手填。
PAT 只用于仓库读取，不能代替登录管理成员或令牌。
领域错误为 `{error: string}`；Axum 提取器的格式错误可能返回纯文本，客户端统一处理。

## 渲染与索引边界

| 路由                                             | 渲染                               | 索引           |
| ------------------------------------------------ | ---------------------------------- | -------------- |
| `/` 项目 landing page                            | SSR                                | 显式开启后允许 |
| `/docs` 系统文档                                 | SSR                                | 显式开启后允许 |
| `/repos/:id` 公开元数据与 README                 | 匿名 SSR                           | 显式开启后允许 |
| 同一路径下的私有仓库                             | 匿名探测仅返回壳，内容在客户端获取 | 禁止           |
| `/workspace`、登录、设置及 `/repos/:id/:section` | SPA，`ssr: false`                  | 禁止           |

公开 SSR 不转发 Cookie / Authorization，也不使用账号 QueryClient。
README 用 `react-markdown` 渲染，忽略原始 HTML。仓库默认优先 `main`，否则首个分支。
工作区不生成业务 HTML。SSR 测试验证真实 HTML、匿名请求边界与私有内容隔离。
`WULING_INDEXABLE` 默认 false；对外开启时同时配置真实 `WULING_PUBLIC_ORIGIN` 并重建。
sitemap 仅包括 landing、文档和匿名可见公开仓库；noindex 不是权限控制。

## Account UI

- `/login`：HeroUI v3 表单，支持密码管理器、键盘访问和失败反馈。
- `/settings/tokens`：API Token 创建、仅一次原文显示、复制、隐藏和撤销。
- `/repos/<id>/members`：维护者添加、修改、移除成员；拒绝权限由后端确认。

图标来自 `@gravity-ui/icons`，组件使用 `@heroui/react` 和 Tailwind v4，
颜色来自 `themes/` 两套 token；应用样式位于 `apps/web/src/styles.css`。
IBM Plex Mono 通过 Google Fonts CDN 加载（SIL OFL 1.1，`display=swap`），
用于仓库名、分支、文件与代码；中文正文使用系统字体。CDN 失败时回退本地等宽字体。
CDN 请求会访问第三方服务；离线/限制外部请求的部署可自行托管同款字体并保留 OFL。
历史协作只读，不提供假写入按钮；私有仓库只能在客户端显示。

网页只发送 HttpOnly Cookie，不读取 JWT。浏览器 API 入口用同源 Web Locks 串行协调
请求与刷新，已登录用户先核对身份，避免 access Cookie 过期后把公开接口的匿名 200
误作当前账号数据。每个请求最多续期一次；刷新失败清理私有状态并返回登录。
不支持 Web Locks 的浏览器不自动消费刷新凭据，失败时要求重新登录，避免多标签页重放。
BroadcastChannel 只广播无凭据的账号变更消息，接收标签页清空缓存并重新加载；
发送来源 ID 防止同一页面误处理自己的登录广播。
QueryClient 仅在客户端会话边界建立，查询键包含账号和仓库；退出、账号变更会丢弃旧页面和路由状态，
迟到请求通过账号代次检查拒绝，BFCache 恢复时重新加载，不持久化私有 Query 数据。

## Browser and visual checks

首次安装 Chromium 到工作区忽略的缓存目录（不改写系统浏览器）：

```sh
cd frontend
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" pnpm exec playwright install chromium
cd ..
sh scripts/check-web.sh
WULING_WEB_TEST_INDEXABLE=true sh scripts/check-web.sh
```

脚本先检查端口空闲，创建独立 PostgreSQL 集群/数据库与测试账号，构建生产前端，
启动真实 Rust API 和前端代理，再使用 **Lightning Node runner + Playwright** 执行整站 E2E。
这不是 DOM 模拟，也不是仅对组件做静态截图；使用独立 `lightning.e2e.config.ts`，
不把 Node 服务管理代码放进 Lightning 的浏览器执行环境。
数据库和服务在退出时关闭，只清理自己启动的进程，不连接业务数据库。
默认测试端口 PostgreSQL 55433 / API 4400 / 前端 3300；
可分别用 `WULING_WEB_TEST_POSTGRES_PORT`、`WULING_WEB_TEST_API_PORT`、`WULING_WEB_TEST_PORT` 覆盖。

验收覆盖错误登录、私有仓库创建、成员权限变更/移除、令牌只显示一次及撤销立即失效、
真实 Cookie HttpOnly、浏览器存储无凭据、双标签页一次续期、跨账号缓存隔离与续期失败隐藏。
截图保存在 `frontend/test-results/auth/`：清新登录/成员、紫霄深色令牌及 375px 移动页；
截图会隐藏真实令牌。当前是截图人工审阅与布局/交互断言，**没有建立像素差分基线**。
同一流程向公开和私有裸仓库推送真实 README，验证 HTML / SPA 边界、唯一 canonical、
sitemap 过滤，以及 Swagger UI；第二条命令覆盖显式开启索引的生产构建。
本轮只覆盖本机 Chromium；Firefox、WebKit 和部署 TLS 尚未验收。

原生 Nasti 适配器针对当前 Start runtime 显式绑定 isomorphic/client-only/server-only 函数，
浏览器禁止加载服务端 Start storage。构建测试防止 `node:async_hooks` 再次进入客户端；
仍不支持通用 `createServerFn` 编译或承诺上游插件全兼容。
