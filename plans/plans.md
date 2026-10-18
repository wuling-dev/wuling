# 武陵DevOps开发计划

## Stage 1：基础功能

Repo，Issue，Merge Request，Pipelines，Wiki，Insight

## 恢复路线（2026-10）

目标是小团队能够完成「私有仓库推拉 → Issue → MR 评审 → 真实 CI → 合并」，
不是恢复旧版所有菜单。旧项目只读参考：`/Users/logos/WebstormProjects/Wuling-old`。
每个批次以真实流程验收，未完成的能力不得在 UI 或文档中宣称可用。

### 已确定的架构边界

- 保留 HeroUI React、`frontend/themes` 的主题 token 和 Nasti 原生适配器。
- 仅项目 landing page、公开仓库 README 与元数据、系统文档走 SSR；仓库列表、
  私有仓库、认证设置、协作编辑、日志等工作区走客户端 SPA。
  私有数据不得进入公共 SSR 缓存或 sitemap；SEO 默认 noindex。
- 借鉴 Delta 的上下文 / 工作区 / checkout / Git 集成分层，但不实现或声称拥有 DeltaDB。
  协作上下文关联仓库和讨论；工作区拥有独立版本标识；checkout 是可重建的磁盘副本。
  MR 显式记录 base/source/target SHA，评审绑定具体版本，更新后重新判断评审与 CI 有效性。
  集成必须校验目标旧值，并记录 Git 与元数据跨存储失败的恢复状态。
  普通 Git 分支不能充当未提交编辑历史；实时编辑同步和会话回滚单独规划。
- Runner 控制面使用版本化 gRPC；浏览器使用 HTTP API，不直接访问 Runner RPC。
  首版仅静态 Linux Runner。领取任务必须原子化、有租约和 attempt ID；
  心跳续租、日志按序去重、完成上报幂等，过期 attempt 不得提交结果。
  限制消息/日志大小，部署时使用 TLS 或受控内网，Runner 凭据与用户凭据分离。
- 现有 JSON / 通用 Item 是原型。引入多人权限与任务派发前迁移到事务数据库及专用模型，
  迁移需备份且可重试，不能默默覆盖旧数据。

### 实施批次

- [ ] 工程底座：ESLint / TypeScript / Clippy 检查、开发与部署脚本、Nix 入口。
- [ ] 身份与归属：用户登录、会话撤销、管理员初始化、成员角色、PAT。
- [ ] Git Smart HTTP：clone/fetch/push、私有读取/推送权限、首次 push、默认分支与事件。
- [ ] 代码浏览：目录、提交历史、diff、README、二进制和大文件限制。
- [ ] Issue：详情、评论、作者、编辑、指派、标签和分页。
- [ ] 协作与 MR：版本快照、diff、评论/评审、非快进合并、最小分支保护。
- [ ] gRPC CI：协议与兼容性测试、静态 Runner、准确 SHA 检出、工作流执行、
  手动/push/MR 触发、日志、取消、超时、失联恢复及 MR 状态。
- [ ] Secrets：外部主密钥、加密存储、最小授权、日志脱敏、不可信 MR 隔离。
- [ ] 运营验收：双账号全流程、重启恢复、备份恢复、HTTPS 与升级验证。

### 参考

- https://delta.dev/docs/concepts/core-concepts
- https://delta.dev/docs/concepts/delta-and-git
- https://delta.dev/docs/concepts/worktrees

不在首版范围：实时 CRDT、云自动扩缩容、多 OS Runner、完整 Actions 生态、
包注册表、编辑器与移动端集成。旧 HTTP Runner 不能原样连接新的 gRPC 服务。
