# Spec Delta

## Purpose

借鉴协作上下文、隔离工作区与磁盘 checkout 的分层，让团队围绕明确版本讨论改动，并通过 MR 显式集成经过评审和检查的代码；不将 Git 分支误称为实时编辑历史或分布式同步数据库。

## ADDED Requirements

### Requirement: 上下文和工作区版本
系统 SHALL 将讨论上下文、工作区版本和磁盘副本分别标识；首版工作区只发布已提交的 Git 快照，磁盘副本可从快照重建，不承诺同步未提交编辑。

#### Scenario: 重建工作副本
- **WHEN** 工作副本丢失而发布快照仍存在
- **THEN** 系统可恢复该版本代码，且不声称恢复未发布编辑

### Requirement: 版本化评审
MR SHALL 展示 base/source/target SHA、提交列表、diff、评论及批准/请求修改；评审 MUST 关联源快照，源变化后旧批准不满足当前版本的批准条件。

#### Scenario: 批准后追加提交
- **WHEN** 已批准 MR 的源引用更新
- **THEN** 页面标记旧批准过期，并为新版本重新判断评审和 CI 条件

### Requirement: 受保护的显式集成
系统 SHALL 支持 fast-forward 和无冲突 merge commit，校验目标旧值、当前源版本、合并权限和配置的评审/CI 门禁；同一规则 MUST 约束 HTTP push 与 MR 合并。

#### Scenario: 目标分支并发更新
- **WHEN** 用户确认合并后目标引用已发生变化
- **THEN** 本次集成拒绝或重新计算并要求确认，不覆盖并发改动

#### Scenario: Git 与元数据故障
- **WHEN** Git 引用已更新但 MR 状态写入失败
- **THEN** 系统记录可恢复集成操作，不报告全程成功，不重复应用合并
