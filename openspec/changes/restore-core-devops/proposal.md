# Proposal

## Why

当前新项目具有六个模块的原型，但共享管理员令牌、本地 Git 写入和手动流水线状态不足以支撑团队日常使用。
恢复小团队「登录授权 → 私有仓库推拉 → Issue → MR 评审 → 真实 CI → 合并」闭环，并使未恢复能力有明确验收和追踪。

## What Changes

- 分四批实施：身份与 Git 托管、协作与版本评审、gRPC CI、运行保障；未验收任务保持未完成。
- 恢复用户、可撤销会话、仓库成员角色、PAT、Git Smart HTTP 和提交浏览。
- 网页采用 HttpOnly Cookie 承载的短期 JWT 与可撤销刷新链；客户端/第三方使用本平台 OAuth 授权（含 Device Flow）或 API Token，现有 PAT 保留为 API Token。
- 引入 `git2` 处理仓库对象操作；Git push/fetch（含 pull 的 fetch 阶段）增加协议兼容的 `remote:` 消息，用于维护公告、彩蛋及用户主动填写并开启的 opt-in 生日祝贺。
- 恢复 Issue 讨论和 MR 版本化评审，借鉴 Delta 上下文/工作区/checkout 的区别，不宣称实现 DeltaDB。
- 独立静态 Linux Runner 通过版本化 gRPC 执行工作流，提供真实结果、日志和租约恢复；恢复必要的 Secrets。
- 保留 HeroUI React、现有主题和 Nasti；按页面选择 SSR，保护私有数据并验证公开内容 SEO。
- **BREAKING**：共享管理员令牌不再作为日常用户身份；原型 JSON 元数据需要显式迁移，旧 HTTP Runner 不能直接连接新 gRPC 服务。
- 延后功能保留清单和触发条件，不以页面存在代替交付。

## Capabilities

### New Capabilities

- `identity-access`：身份、JWT Cookie 会话与刷新撤销、OAuth/Device Flow、仓库成员、API Token 与原型元数据迁移。
- `repository-hosting`：Git HTTP 传输、remote 消息、默认分支、提交与文件浏览。
- `issue-collaboration`：Issue 详情、评论、指派、标签和检索。
- `change-review`：协作上下文、版本化工作区与 MR 评审和受保护集成。
- `pipeline-execution`：gRPC Runner、工作流执行、触发、日志和故障恢复。
- `secret-delivery`：加密机密存储、授权下发和日志脱敏。
- `web-delivery`：选择性 SSR、SEO、交互数据隔离及运行恢复验收。

### Modified Capabilities

无。初始化时 `openspec list --specs` 为空，现有行为以代码和 README 为基线。

## Impact

后端 `crates/server` 将从单文件 JSON 原型演进为事务数据层和分域模块；
前端 API、路由和工作区增加认证与详情流程，继续使用 HeroUI 和主题 token。
新增数据库迁移、gRPC/protobuf 和独立 Runner；部署增加数据库、Runner 认证/网络与备份约束。
新增 JWT 签名密钥与轮换、OAuth 客户端/授权/设备码持久化和 `git2` 原生依赖的构建与许可证验收。
已有不透明 Cookie 会话的验收不代表 JWT 已交付；生日祝贺默认关闭，仅保存用户主动填写的月日、选择的时区和开启状态，不收集出生年份，不从 Git 作者信息推断，支持关闭和删除。
旧项目只读参考行为、协议与测试，不直接搬运全部 Go 架构，也不承诺旧库自动迁移。
