# Design

## Context

见 proposal.md。当前后端集中在 `crates/server/src/main.rs`，`Repo` 与通用 `Item`
通过进程互斥写 JSON，权限只有管理员令牌；Git 已通过系统命令执行。
前端显式路由树区分 SSR 概览和 `ssr: false` 工作区，主题位于 `frontend/themes`，
HeroUI 与 TanStack Query/Virtual 已在依赖中，但尚未形成分域交互数据层。
现有测试覆盖基础资源、Git 浏览/快进合并、适配器、生产 HTTP 与 SPA shell。

旧版 `internal/githttp` 有真实 Git 协议测试，`issuehttp` / `mrhttp` 有讨论评审流程；
`pipeline` / `runnerhttp` 与 `runners/runner-clients` 可参考，但旧控制面是 Go、
Runner 使用 HTTP，不满足新 gRPC 决策。旧代码存在不等于新平台已交付。

## Goals / Non-Goals

**Goals:**
- 分阶段替换原型，先交付本地身份与 HTTP Git，再叠加协作和真实 CI。
- 每批有拒绝权限、并发和故障场景测试；规格只在归档后成为主规格。
- 公共页面允许匿名 SSR；认证凭据不得置于服务端模块全局变量或公共缓存。

**Non-Goals:**
- 不恢复旧版全量组织/项目层级，不引入实时 CRDT 和 DeltaDB 副本协议。
- 不兼容旧 Go 数据库的自动升级；仅迁移当前 Rust 原型 JSON。
- 不实现全 Actions 生态、云资源调度或任意不可信代码的强隔离。

## Decisions

### 1. 事务元数据与仓库级归属

采用 PostgreSQL 和版本化迁移；将身份、仓库成员、Issue、MR、工作区版本、
运行/任务/尝试分别建模，Git 对象仍保留在磁盘裸仓库。
SQLite 更易单机部署，但任务并发摘取与恢复需求更适合 PostgreSQL；
继续扩大 JSON 模型无法可靠支持多身份、租约和事务事件。
首版用户拥有仓库，直接邀请仓库成员，不强制组织/项目层级。
历史数据迁移时由部署者显式指定归属，保留原 ID 与历史导入标记。

### 2. 最小身份闭环

先恢复本地账号：部署者在本机执行一次性管理员引导，随后由管理员创建账号，
公开注册关闭。密码强哈希，网页会话采用 HttpOnly、生产 Secure、
SameSite Cookie 和服务端摘要存储；写请求增加 Origin/CSRF 校验。
PAT 随机生成、只展示一次、摘要落库、限定权限和期限，Git Basic 密码位携带 PAT。
每次请求核对账号状态与成员权限；不保留共享管理员令牌作为权限后门。
GitHub OAuth 延后，避免在首批同时实现多套身份入口。

### 3. 系统 Git 与统一授权

延续系统 Git，使用 Smart HTTP 后端处理标准协议，不手写 packfile；
先权限检查，再启动有超时、资源和流量限制的 Git 子进程。
浏览与传输共用仓库权限；受保护分支必须在引用写入前校验，
不能只在 push 返回后检查。成功事件记录引用前后 SHA，按事件键去重。

### 4. 工作区快照与显式集成

分别持久化讨论上下文、工作区和不可变已提交版本；checkout 可重建。
首版只支持仓库内源分支，不支持 fork MR 或未提交编辑同步。
MR 版本记录 merge base、source 和 target SHA；评论保留版本归属，
批准在源版本变化后失效。CI 同样绑定版本，不用分支名替代 SHA。
集成操作写入持久意图，Git 使用旧值比较更新；数据库状态失败由恢复流程对账。
目标变化时重新计算并要求确认，禁止无提示合并未展示版本。

参考：
- https://delta.dev/docs/concepts/core-concepts
- https://delta.dev/docs/concepts/delta-and-git
- https://delta.dev/docs/concepts/worktrees

### 5. 独立 gRPC Runner

新增版本化 protobuf（`wuling.runner.v1`），Rust 控制面与独立 Rust Runner
使用生成代码；浏览器继续调用 HTTP，不引入 gRPC-Web。
RPC 覆盖注册、心跳、领取、日志、step 状态和完成。
数据库原子领取任务并生成 attempt/租约；迟到 attempt 拒绝，重试有界，
日志按 attempt 与序号幂等写入，完成重复上报返回相同终态。
控制面负责事件去重和 needs DAG；执行端检出固定 SHA，在专用 Linux 容器执行。
首版日志轮询，优先实现正确性而非双向流复杂度。旧 HTTP Runner 不原样接入。
生产使用 TLS，凭据按 Runner、仓库和任务划分；容器不视为恶意代码充分隔离。

### 6. 前端与机密边界

继续使用 HeroUI React 和已有主题，新增组件不另建配色系统。
TanStack Query 负责按用户/仓库/版本分键的客户端查询和失效；SSR 每请求独立状态，
退出清理私有缓存。长日志/大列表按需要使用 Virtual，不因依赖存在就强制引入。
保留 Nasti 显式路由适配；认证页和编辑/日志为客户端，公开概览 SSR。
先做仓库级 Secrets，外部持久密钥加密，只有有效 attempt 获取。
首版所有 MR 工作流默认不注入 Secrets；可信手动/受控 push 工作流方可授权下发。

## Risks / Trade-offs

- [数据库增加部署成本] → 同步更新本地与 Nix 入口，提供健康检查和迁移说明。
- [Git 与 SQL 无跨存储事务] → 持久集成意图、引用旧值比较、故障注入与启动对账。
- [副作用任务无法真正 exactly-once] → attempt fencing、有界重试，文档明确任务需幂等。
- [Secret 变形无法完全脱敏] → 跨块原文脱敏，不可信 MR 不发机密，禁止主动打印凭据。
- [Nasti 适配器升级风险] → 保留真实构建/SSR 测试，增加公开页和私有跨账号测试。
- [恢复范围较大] → tasks 按四批验收，不以整个提案存在来宣称功能完成。

## Migration Plan

1. 停止写入并备份当前数据目录，记录 JSON 与仓库引用校验。
2. 创建新数据库并运行迁移；以显式账号映射导入元数据，不移动 Git 对象。
3. 验证 ID、可见性、记录数量、内容和引用一致性，再切换新服务。
4. 不启用新 Runner 前核验 gRPC 身份与消息上限，禁止新旧客户端混用。
5. 切换后如需回退，停止新写入并恢复备份；不得直接启动旧版本读取新数据。
   新写入的保存/导出需单独核对，备份回退不保证保留切换后的数据。
