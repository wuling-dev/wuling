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
单独检查适配器：

```sh
pnpm --filter @wuling/nasti-tanstack-start typecheck
```
