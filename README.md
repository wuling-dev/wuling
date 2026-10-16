# 武陵 DevOps（Rust 重写）

直接实现 `plans/plans.md` 的第一阶段原型，不引入 spec-driven 工作流。自有代码许可见 `License`，品牌图稿只按 `assets/BRAND-USAGE.md` 授权使用；第三方清单见 `third-party-license.md`。

## 启动

需要 Rust、系统 Git、Node（见 `.nvmrc`）和项目指定的 pnpm。

在项目根目录运行后端（令牌请自行生成，至少32字符）：

```sh
WULING_ADMIN_TOKEN='<random-secret-at-least-32-characters>' cargo run -p wuling-server
```

另一个终端在 `frontend/`：复制 `.env.example` 为 `.env`，执行 `pnpm dev`。生产构建：`pnpm build`，然后 `pnpm start`。两个服务默认只监听 loopback；公开部署必须在前方配置 HTTPS、访问控制、限流和备份。**本版本是单进程开发原型，不适合直接暴露为多租户生产服务。**

前端「偏好与访问」中应用管理员令牌；令牌仅保存在页面内存，刷新清除。匿名用户只能读取公开仓库。私有仓库概览目前不支持直达 SSR 认证，需要在列表应用令牌后刷新并通过客户端导航进入。

数据默认保存为 `data/state.json` 和 `data/repos/<id>.git`；可设置 `WULING_DATA_DIR`。元数据使用串行互斥和临时文件 rename，不能多实例共享同一数据目录。备份必须同时覆盖两者。

## 当前功能与边界

| 模块 | 已实现 | 尚未实现 |
| --- | --- | --- |
| Repo | 创建公开/私有裸仓库、分支/文件列表、文本读取 | HTTP/SSH clone/push、导入、权限成员、提交浏览 |
| Issue | 创建、列表、关闭/重新打开 | 评论、标签、指派 |
| Merge Request | 源/目标分支校验、创建、fast-forward 合并、关闭 | 非快进合并、diff/review、分支保护 |
| Pipelines | 持久化队列、状态转换记录 | 真实执行、隔离 Runner、日志流、自动触发；当前状态由管理员手动记录 |
| Wiki | 创建、读取、编辑正文、关闭 | Markdown 渲染、历史版本 |
| Insight | 实时汇总 Issue/MR/流水线状态/Wiki 数量 | 提交趋势、耗时等高级统计 |

向新建仓库写入代码，目前需服务主机本地 Git：`git push /absolute/path/to/data/repos/<id>.git main`。合并通过系统 Git 的 ancestor 检查和带旧值的 `update-ref` 执行。Git 引用更新与 JSON 元数据并非跨存储事务，故障恢复需核对引用。没有添加 OAuth、旧版数据迁移、真实构建执行或完整 Git 托管协议，不能视为旧版功能对等替换。

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
