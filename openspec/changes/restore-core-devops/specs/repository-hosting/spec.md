# Spec Delta

## Purpose

让开发者无需访问服务端文件系统即可使用标准 Git 客户端托管仓库，并在网页上浏览准确版本的代码和提交。传输和浏览必须遵循同一套公开性、成员权限与资源限制。

## ADDED Requirements

### Requirement: 标准 Git HTTP 传输
系统 SHALL 支持标准 Git 客户端通过 HTTPS clone、fetch 和 push；匿名只能读公开仓库，私有读取和全部写入 MUST 校验用户权限及 PAT 范围。

#### Scenario: 首次推送空仓库
- **WHEN** 开发者使用有效写入 PAT 向空仓库推送分支
- **THEN** 推送成功，页面展示正确默认分支和可用 clone 地址

#### Scenario: 未授权私有读取
- **WHEN** 无权限客户端请求私有仓库的引用或对象
- **THEN** 系统拒绝传输且不泄露私有引用或对象内容

### Requirement: 版本浏览和资源限制
系统 SHALL 提供分支、目录、文件、提交历史、单次提交 diff 与安全 Markdown README；所有版本参数和路径 MUST 验证，二进制、大文件和超限 diff 必须有明确受限提示。

#### Scenario: 浏览固定提交
- **WHEN** 用户打开一个提交的文件并且分支随后更新
- **THEN** 显示内容仍对应该提交，不静默切换为分支最新内容

### Requirement: 引用更新事件
系统 SHALL 仅为成功更新的引用生成可去重事件，携带仓库、引用、更新前后 SHA 和操作者。

#### Scenario: 推送被拒绝
- **WHEN** 推送因权限或分支保护被拒绝
- **THEN** 不产生表示成功更新的流水线触发事件
