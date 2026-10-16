# Spec Delta

## Purpose

将手动状态记录替换为独立执行端产生的真实 CI 结果，使仓库工作流在固定提交上可靠运行。通过版本化 gRPC、任务租约和幂等上报约束断线与重试，向团队提供可信的日志和合并检查。

## ADDED Requirements

### Requirement: 真实工作流执行
系统 SHALL 从触发提交读取 `.wuling/workflows/*.yml`，支持 jobs、steps、run、checkout、基本 needs 依赖及手动/push/MR 触发；未知字段 MUST 明确拒绝，成功状态只能来自真实执行结果。

#### Scenario: 分支在排队期间移动
- **WHEN** 工作流排队后源分支追加提交
- **THEN** 本次运行仍检出并执行触发时 SHA，结果不归属新提交

#### Scenario: 构建失败
- **WHEN** step 返回非零退出码
- **THEN** 任务失败，依赖的普通任务不执行，MR 不获得成功检查

### Requirement: gRPC 与执行授权
Runner SHALL 使用版本化 gRPC 完成注册、心跳、领取、日志、step 与完成上报；凭据 MUST 独立于用户会话，任务只向匹配且获授权的 Runner 派发，仓库检出凭据必须短期且仅限该仓库读取。

#### Scenario: 不兼容客户端
- **WHEN** 客户端声明不兼容协议版本
- **THEN** 服务明确拒绝且不派发任务或机密

### Requirement: 租约与幂等上报
每次任务尝试 MUST 有租约和独立 attempt 标识；日志按序号去重，完成上报幂等；过期尝试不能改变新尝试状态，失联重试次数必须有上限。

#### Scenario: 旧执行端恢复网络
- **WHEN** 任务已重新派发而旧 attempt 上报成功
- **THEN** 旧结果被拒绝，不覆盖新 attempt 的状态或日志

### Requirement: 日志与取消
用户 SHALL 可读取有界增量日志、取消和查看超时结果；Runner MUST 在专用执行环境运行，清理任务资源，不与 API 进程执行用户命令。

#### Scenario: 超时后迟到上报
- **WHEN** 任务超时并终止后收到成功上报
- **THEN** 任务仍保持超时失败，不被改为成功
