# Spec Delta

## Purpose

为团队成员提供独立身份和可撤销访问凭据，使网页操作、Git 推拉与自动化请求共享一致的仓库授权边界，并保证已有原型数据能够在明确归属和备份保护下迁移。

## ADDED Requirements

### Requirement: 用户会话与管理员引导
系统 SHALL 支持本地账号登录、退出和服务端会话撤销；首次管理员初始化 MUST 仅在尚无管理员时由部署者授权执行，公开注册默认关闭。

#### Scenario: 撤销后拒绝访问
- **WHEN** 用户退出或管理员停用其账号
- **THEN** 该用户既有会话不能继续执行认证请求

#### Scenario: 禁止重复引导
- **WHEN** 实例已有管理员且收到初始化请求
- **THEN** 系统拒绝创建另一名引导管理员

### Requirement: 网页 JWT Cookie
网页认证 SHALL 使用短期 JWT，并且仅通过 HttpOnly Cookie 交付；生产 Cookie MUST 使用 Secure 和明确的 SameSite 策略。JWT MUST 校验签名、允许的算法、issuer、audience、有效期及关联服务端会话状态；不得用签名有效替代账号状态和当前仓库授权检查。

#### Scenario: 前端不可读取网页凭据
- **WHEN** 浏览器完成登录
- **THEN** 响应通过 HttpOnly Cookie 设置网页 JWT，不在 JSON、SSR HTML、前端状态或浏览器本地存储中暴露令牌原文

#### Scenario: 已签名但已撤销
- **WHEN** JWT 签名和有效期仍正确，但关联会话已撤销或账号已停用
- **THEN** 请求被拒绝，不等待 JWT 自然到期

#### Scenario: 无效 JWT
- **WHEN** JWT 算法、签名、issuer、audience 或有效期无效
- **THEN** 系统拒绝认证，不回退到共享管理员令牌

### Requirement: 网页续期与写请求防护
网页续期 SHALL 使用 HttpOnly Cookie 承载的可撤销刷新凭据，服务端仅保存摘要，成功使用后轮换；已使用刷新凭据重放 MUST 撤销关联刷新链及会话。登录、续期、退出和其他 Cookie 认证写请求 MUST 校验来源并防御 CSRF；退出必须清除认证 Cookie。

#### Scenario: 刷新凭据重放
- **WHEN** 同一刷新凭据在已成功轮换后再次使用
- **THEN** 系统拒绝请求并撤销该刷新链，关联网页 JWT 不能继续使用

#### Scenario: 跨站续期或退出
- **WHEN** 不可信来源尝试刷新会话或发起退出写请求
- **THEN** 系统拒绝操作，不续期、不改变用户会话

### Requirement: 第三方 OAuth 授权
系统 SHALL 作为授权服务器向客户端与第三方提供 Authorization Code + PKCE（S256）及 Device Authorization Grant。授权 MUST 绑定注册客户端、用户确认的 scope、当前账号与仓库权限；第三方不能通过这些流程获得网页 JWT Cookie，外部 GitHub 登录不属于此要求。

#### Scenario: 授权码绑定与单次使用
- **WHEN** 客户端使用授权码交换令牌
- **THEN** 系统校验客户端、精确注册的 redirect URI 和 PKCE；错误绑定、错误 verifier 或重复交换均被拒绝

#### Scenario: 用户拒绝授权
- **WHEN** 用户在展示客户端身份和 scope 的确认页拒绝请求
- **THEN** 系统不向客户端签发访问或刷新凭据，并按协议返回拒绝结果

### Requirement: OAuth Device Flow
Device Flow SHALL 返回有期限的 device code、user code、验证地址和轮询间隔；用户必须在可信网页核对设备请求并显式批准。设备轮询 MUST 区分 authorization_pending、slow_down、access_denied 和 expired_token，批准后的授权结果仅允许单次领取。

#### Scenario: 高频轮询
- **WHEN** 设备在允许间隔前反复请求令牌
- **THEN** 系统返回 slow_down 并提高后续轮询间隔，不提前授权

#### Scenario: 过期或拒绝
- **WHEN** 设备码已过期或用户拒绝设备请求
- **THEN** 轮询得到对应协议错误，不签发任何用户凭据

#### Scenario: 设备请求批准
- **WHEN** 用户核对 user code、客户端及 scope 后批准有效设备请求
- **THEN** 只有绑定客户端可在期限内单次领取授权令牌，重复领取被拒绝

### Requirement: OAuth 凭据生命周期
OAuth 访问与刷新凭据 SHALL 可撤销并具有期限；刷新凭据必须轮换并检测重放。系统 MUST 提供已授权应用的查看和撤销能力，账号停用、授权撤销或成员权限变化后不得继续沿用旧权限。

#### Scenario: 撤销应用
- **WHEN** 用户撤销某客户端授权
- **THEN** 该授权产生的访问和刷新凭据均不能继续访问用户资源，其他独立授权不被误撤销

### Requirement: 仓库授权与访问令牌
系统 SHALL 提供仓库只读、开发者、维护者角色，记录操作作者；API Token（现有 PAT）MUST 有期限、读写范围且可撤销，不能超出持有人的当前仓库权限。OAuth 的有效 scope 同样不能超出用户当前权限。

#### Scenario: 只读令牌禁止推送
- **WHEN** 有开发权限的用户使用只读 PAT 推送
- **THEN** 系统拒绝写入且仓库引用不变

#### Scenario: 移除成员立即失效
- **WHEN** 用户被移出私有仓库成员列表
- **THEN** 其会话和 PAT 均不能读取该仓库

### Requirement: 显式原型迁移
系统 MUST 在写入新数据格式前要求备份和明确的数据归属；迁移 SHALL 保留仓库 ID、Git 内容和协作记录，可检测重复执行，不得将未知作者伪装为新管理员。

#### Scenario: 迁移中断
- **WHEN** 导入原型 JSON 的过程失败
- **THEN** 原始数据保持可恢复，重试不会重复创建记录，未知作者标为历史导入
