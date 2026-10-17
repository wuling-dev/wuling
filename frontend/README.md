# Frontend workspace

`frontend/` 是 pnpm monorepo 根目录，同时保留现有 Web 应用入口，避免改变启动脚本、
静态资源、SSR 构建和部署路径。共用一份 `pnpm-lock.yaml`，使用项目指定的 pnpm 版本。

## Packages

- 根包 `frontend`：Web 应用、主题、路由、生产服务和应用集成测试。
- `packages/nasti-tanstack-start`：私有包 `@wuling/nasti-tanstack-start`，
  通过 `workspace:*` 引用，直接导出 TypeScript 源码，由 Nasti 和测试工具处理。
  不发布到公共注册表，不增加额外预构建步骤。

包之间通过包名及 `exports` 引用，不跨目录导入内部文件。
新增共享包放到 `packages/*`，声明自己的依赖、导出和类型检查脚本。
当前只有一个应用，不为目录整齐而引入额外调度工具或空包。

## Commands

在 `frontend/` 执行：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm start
```

`pnpm typecheck` 包含应用和 workspace 子包。
`pnpm test` 仍先构建再执行 Lightning 的适配器、SSR 和生产 HTTP 测试。
另外覆盖账号请求隔离、续期串行化、失败不循环重试和迟到私有响应丢弃。
单独检查适配器：

```sh
pnpm --filter @wuling/nasti-tanstack-start typecheck
```

## Account UI

- `/login`：HeroUI v3 表单，支持密码管理器、键盘访问和失败反馈。
- `/settings/tokens`：API Token 创建、仅一次原文显示、复制、隐藏和撤销。
- `/repos/<id>/members`：维护者添加、修改、移除成员；拒绝权限由后端确认。

图标来自 `@gravity-ui/icons`，组件使用 `@heroui/react` 和 Tailwind v4，
颜色仍来自 `themes/` 两套 token；旧页面基础样式单独放在 `legacy.css` 低优先级层。
认证设置页为客户端渲染，公开首页/概览维持匿名 SSR；私有概览直达 SSR 认证仍待 8.1。
历史协作写入尚未恢复，旧工作区写操作仍会得到后端只读错误，不代表功能已恢复。

网页只发送 HttpOnly Cookie，不读取 JWT。浏览器 API 入口用同源 Web Locks 串行协调
请求与刷新，已登录用户先核对身份，避免 access Cookie 过期后把公开接口的匿名 200
误作当前账号数据。每个请求最多续期一次；刷新失败清理私有状态并返回登录。
不支持 Web Locks 的浏览器不自动消费刷新凭据，失败时要求重新登录，避免多标签页重放。
BroadcastChannel 只广播无凭据的账号变更消息，接收标签页清空缓存并重新加载；
发送来源 ID 防止同一页面误处理自己的登录广播。
QueryClient 按渲染实例建立，查询键包含账号和仓库；退出、账号变更会丢弃旧页面和路由状态，
迟到请求通过账号代次检查拒绝，BFCache 恢复时重新加载，不持久化私有 Query 数据。

## Browser and visual checks

首次安装 Chromium 到工作区忽略的缓存目录（不改写系统浏览器）：

```sh
cd frontend
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" pnpm exec playwright install chromium
cd ..
sh scripts/check-web.sh
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
本轮只覆盖本机 Chromium；Firefox、WebKit 和部署 TLS 尚未验收。

原生 Nasti 适配器针对当前 Start runtime 显式绑定 isomorphic/client-only/server-only 函数，
浏览器禁止加载服务端 Start storage。构建测试防止 `node:async_hooks` 再次进入客户端；
仍不支持通用 `createServerFn` 编译或承诺上游插件全兼容。
