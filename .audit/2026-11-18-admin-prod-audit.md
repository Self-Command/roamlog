# Roamlog 生产 Admin 端功能审计

- 审计日期：2026-11-18
- 审计对象：`https://we.spacedo.org/admin`
- 部署镜像：`v0.1.0-rc.3`
- 审计身份：平台 `super_admin`，使用生产配置中的凭据与 TOTP
- 审计方式：桌面/窄屏浏览器实操、页面控件遍历、只读 API/数据库/容器检查、静态代码对照
- 审计边界：未提交任何业务 mutation；危险确认框均打开后取消。登录产生认证会话，但未修改业务数据
- 总体结论：**BLOCKED**（后台可登录，但存在 2 个 P0，且邮件链路实际不可用于真实用户）
- 交付状态：**DONE**（审计已完成；发布验收不通过）

## 1. 执行摘要

用户反馈的“很多功能无法点击/没做完”**基本属实，但不是权限问题**。本次账号是 `super_admin`，页面和 API 没有返回 403；所有被观察到的禁用、空白和无响应都可以归入以下四类：

1. **两个页面整体报错**：总览与审计日志均返回 HTTP 500。原因是生产审计记录中存在 1 条 UUIDv4 主键，而 API 契约强制 UUIDv7，导致整页 Zod 校验失败。
2. **邮件环境是测试配置**：当前 URL 运行的是 `docker/compose.staging.yml` 栈，且强制 `SMTP_HOST: mailpit`。Mailpit 容器正在运行，数据库中的 3 封认证邮件全部停留在 `sent`，`delivered` 为 0。若该域名被视为生产环境，用户收不到验证/重置邮件。
3. **部分功能是 fixture/硬编码残留**：侧栏环境 `LOCAL`、2FA 状态、通知 badge/通知列表、系统 Redis 面板、队列吞吐、举报数、媒体桶名等并非来自生产 API。
4. **相当一部分能力未实现或只做了首屏**：举报/审核队列、邀请、用户/工作区完整详情、分页、排序、用户导出、测试邮件、功能开关创建、计划变更/所有权转移、运营设置均不存在。

同域部署本身基本正常：10 个后台路由刷新均返回 200，14 个 JS 与 4 个 CSS 静态资源全部从 `/admin-assets/` 成功加载，`/v1` API 同域，未知路由返回自定义 404。没有观察到 WebSocket。

生产库不是“大规模 demo 数据”，但也不是干净的生产数据：2 个账号全部是平台管理员（1 个 `admin`、1 个 `super_admin`），`super_admin` 使用 `.local` 域；另有 19 个会话、2 个免费 Workspace、1 次旅行和 1 个行程参与者。没有 JournalEntry、Comment、Media、Invitation、Notification、FeatureFlag 或 ShareLink。

## 2. 验收判定与完成度

### 2.1 结论

| 维度 | 判定 | 依据 |
|---|---|---|
| 登录/2FA | 通过 | 邮箱密码 + TOTP 可登录；会话 Cookie 为 Secure/HttpOnly/SameSite=Lax |
| 同域路由/静态资源 | 通过 | 10 个路由刷新 200；14 JS + 4 CSS 全 200；404 页面正常 |
| 权限模型 | 基本通过 | `super_admin` 可打开写操作确认框；未出现 403；角色选择按设计锁定 |
| 核心页面可用性 | 不通过 | 总览、审计日志均 500 |
| 数据真实性 | 不通过 | 多处 fixture/硬编码，且系统状态自相矛盾 |
| 邮件/队列 | 不通过 | Mailpit 吞邮件；队列吞吐为固定 0；Worker 状态误报 |
| 功能完整度 | 不通过 | 举报、邀请、分页、排序、导出、运营设置等缺失 |

### 2.2 完成度

- **表面控件覆盖率：约 78%**。导航、列表、筛选、详情抽屉、危险确认框、批量选择等骨架已存在。
- **按“生产用户可完成的任务”加权：约 45%**。
- **权限可用度：约 90%**。阻断来自数据契约、环境与未实现，不是授权失败。

加权口径：

| 区域 | 权重 | 得分 | 依据 |
|---|---:|---:|---|
| 登录/Shell | 10% | 55% | 登录真实；环境/2FA/通知/登出错误 |
| 总览 | 10% | 10% | 整页 500；趋势不可用 |
| 用户 | 12% | 65% | 列表/筛选/操作骨架可用；详情与导出缺失 |
| 工作区 | 10% | 55% | 列表/操作可用；成员与体量缺失 |
| 内容审核 | 13% | 45% | 内容列表真实；举报/审核队列缺失 |
| 媒体 | 5% | 65% | 真实空列表；桶名硬编码 |
| 审计 | 10% | 10% | 整页 500；导出不可达 |
| 功能开关 | 5% | 35% | 读写接口存在；0 条数据、无创建、无空状态 |
| 邮件 | 10% | 35% | 真实日志；Mailpit、测试入口缺失、重发无状态限制 |
| 队列 | 5% | 60% | 计数/操作真实；吞吐/健康为假 |
| 系统健康 | 5% | 45% | 3 项探针真实；Worker/Redis 面板错误 |
| 同域集成 | 5% | 80% | 路由/资源正常；登出与长缓存有风险 |

## 3. 关键缺陷

### P0-01 审计记录违反 UUIDv7 契约，导致总览与审计日志整页 500

- 现象：`GET /v1/admin/audit` 返回 500；总览同时请求 metrics、emails、audit，任一失败即整页进入错误边界；点击“重试”后仍复现。
- 根因证据：`AuditLogSchema` 的 `id`、`actorId`、`targetId` 使用 `UuidV7Schema`；`presentAdminAuditLog()` 直接 `AuditLogSchema.parse()`。生产 5 条审计记录中，`admin.user.updated` 的 ID 版本位为 `4`，其余 4 条为 `7`。Zod 报错路径为 `["id"]`。
- 影响：平台总览、审计列表、审计导出全部不可用；同时把本可展示的 metrics/emails 数据一起丢弃。
- 证据：`evidence/pages-observations.json`、`evidence/dashboard-desktop.png`、`evidence/audit.png`、`evidence/production-facts.json`
- 代码：`apps/api/src/modules/admin/admin.presenters.ts:35`、`packages/contracts/src/entities/audit-log.ts:8`

### P0-02 部署为 staging 邮件配置，真实用户无法收到邮件

- 现象：3 封认证类邮件均为 `sent`，`delivered/bounced/complained/failed` 全为 0；邮件页和总览邮件指标因此看起来“没有投递”。
- 根因：当前栈名为 `roamlog-staging`，来自 `docker/compose.staging.yml`；API 被强制设置 `SMTP_HOST: mailpit`，Mailpit 容器运行且健康。代码优先使用 SMTP，Mailpit 存在时不会走 Resend。
- 影响：注册验证、密码重置等关键链路在“生产 URL”上只写入测试收件箱，不触达真实用户。数据库 `EmailLog` 的 `sent` 只表示交给 Mailpit，不代表送达。
- 证据：`evidence/production-facts.json`、`evidence/emails.png`
- 代码/配置：`docker/compose.staging.yml:1`、`:102`、`:166`、`apps/api/src/modules/auth/email-delivery.service.ts:204`

### P1-01 “假登出”与错误的环境身份

- 侧栏环境徽标固定 `LOCAL`，但系统健康页显示 `PRODUCTION`；`ApiSessionProvider` 在 API 模式下仍硬编码 `environment: "local"`、`twoFactorEnabled: false`。
- 顶部显示 `2FA GATED`，侧栏同时硬编码 `2FA 已启用`；实际登录已经通过 TOTP，两个状态都不可信。
- “返回登录占位”只是 `<a href="/admin/login">`，没有调用 sign-out。点击后 Cookie 仍存在，重新访问 `/admin` 仍是已登录状态。
- 证据：`evidence/navigation-mobile.png`、`evidence/interaction-extra.json`、`evidence/system.png`
- 代码：`apps/admin/components/admin-shell/mock-session-provider.tsx:92-93`、`admin-sidebar.tsx:127,169`、`admin-topbar.tsx:123`

### P1-02 通知是 fixture，badge 永远显示 2 条未读

- 通知抽屉读取 `MOCK_ADMIN_NOTIFICATIONS`，不请求 API；顶部 aria-label 固定为“通知，2 条未读”。
- “全部标为已读”只改本地 fixture 状态，顶部 badge 不变；刷新后恢复 2 条。
- 数据库 `Notification=0`，也没有 Admin 通知接口。
- 代码：`apps/admin/components/admin-shell/admin-notifications-sheet.tsx:16,32`、`admin-topbar.tsx:104`

### P1-03 全局搜索承诺搜索用户/工作区，API 模式只搜页面

- 搜索框文案为“搜索页面、用户或工作区”，页脚却仍显示 `Fixture search boundary`。
- `⌘K / Ctrl+K` 可以打开面板，页面跳转可用；用户和工作区实体结果在 API 模式不存在。
- 代码：`apps/admin/components/admin-shell/admin-command-palette.tsx:153`

### P1-04 用户管理缺详情、导出与规模能力

- 列表 2 条真实记录；搜索、状态、角色筛选是**浏览器内过滤**，不请求服务端。
- 详情抽屉能打开，但 Workspace、旅行、日志、活跃会话全部显示 `—`；`mapAdminUsers` 固定填 0，UI 在 API 模式隐藏 0。
- “导出 CSV”被禁用，title 明确写着“导出接口将在运营 Wave 接入”。
- 表头写 `USERS / CURSOR PAGE 1`，但没有下一页、上一页、游标或总数；API 固定 `limit: 100`。
- 代码：`apps/admin/lib/admin-data-source.ts:239-254,563`、`apps/admin/components/users/users-view.tsx:312,417,517`

### P1-05 工作区缺成员、体量、套餐变更与所有权转移

- 列表 2 条真实记录；搜索/状态/套餐为本地过滤。
- “活跃成员总量”显示 `—`；成员/旅行/日志列在 API 模式显示 `—`。数据库实际有 2 条 WorkspaceMember，但 Admin 列表响应未提供。
- 详情明确提示“当前 Admin API 列表响应未提供成员明细”。
- 无套餐变更、所有权转移、成员管理、邀请入口。
- 表头同样写 `TENANTS / API PAGE 1`，但没有分页。
- 代码：`apps/admin/lib/admin-data-source.ts:254`、`apps/admin/components/workspaces/workspaces-view.tsx:558,628`

### P1-06 举报/审核队列未实现，举报数硬编码

- 内容页可读取 Trip/Entry/Comment 三类真实 API；当前 1 条 Trip、0 Entry、0 Comment。
- “待审核举报 0 reports”不是 API 数据，而是固定值；`flagged` 状态也没有真实来源，无法产出记录。
- 数据库不存在 Report/Moderation 表，Admin 没有举报列表、举报详情、裁决、保留/删除证据链。
- 分享链接若存在会拼接 `http://localhost:3000/share/...`，在生产是错误地址。
- 代码：`apps/admin/lib/admin-data-source.ts:313,328,343`、`apps/admin/components/content/content-view.tsx:214,257,512,527`

### P1-07 审计页除 500 外，筛选 actor 仍使用 fixture

- 审计页因 P0-01 无法渲染；即使修复主键，actor 下拉仍来自 `MOCK_ADMIN_USERS`，无法匹配真实管理员。
- 页面没有分页；列表固定 `limit: 100`。日期使用原生 `input[type=date]`，没有时间范围或时区提示。
- 导出按钮在错误页不可达；API 导出路径共用同一 presenter，预计同样 500，因此本次未触发含 PII 的下载。
- 代码：`apps/admin/components/audit/audit-view.tsx:45,264`、`apps/admin/lib/admin-data-source.ts:620`

### P1-08 功能开关页近乎空白，且无法创建

- 生产 `FeatureFlag=0`；页面只有标题、两个 badge 和说明卡，没有空状态或“新建开关”按钮。
- API 只有 `GET /flags` 与 `PATCH /flags/:key`，没有 create/delete。因此零数据时运营无法自助建立开关。
- 有数据时的保存、灰度滑块、Workspace 白名单、确认/审计代码存在，但本次无数据可验证。
- 证据：`evidence/flags.png`
- 代码：`apps/admin/components/flags/flags-view.tsx`、`apps/api/src/modules/admin/admin-operations.controller.ts:65-78`

### P1-09 邮件“重发”不区分状态，测试邮件缺失

- 3 条 `sent` 记录每行都有可用的“重发”按钮；页面文案却写“重发失败邮件”。后端 mutation 也未按 failed/bounced 状态限制，存在重复发送风险。
- “测试邮件”按钮禁用，title 明确为“API 契约暂未提供测试邮件入口”。
- 顶部只展示 delivered/bounced/complained/failed，遗漏当前占 100% 的 `sent`；因此 3 条日志对应 4 个 0。
- 代码：`apps/admin/components/emails/emails-view.tsx:195,369-379`

### P1-10 队列吞吐是假值，健康状态与 Worker 实际状态冲突

- 5 个队列计数来自真实 Redis；失败任务为 0，空状态正常。
- `mapAdminQueues()` 固定 `throughputPerMinute: 0`，所有卡片都显示 `0.0 jobs/min`。
- 顶部写“跨四个队列”，页面实际 5 个队列。
- 系统健康 API 报 Worker `DOWN`、0 consumers；Docker Worker 实际 `running/healthy`，Redis 有 6 个 blocked clients。说明 `workerHealth()` 的 CLIENT LIST 名称匹配与实际 worker 连接命名不一致。
- 队列页仍给所有队列 `HEALTHY`，因为健康只由计数/暂停推导，不包含 Worker 状态。
- 代码：`apps/admin/lib/admin-data-source.ts:410`、`apps/admin/components/queues/queues-view.tsx:230,241,317`、`apps/api/src/modules/admin/admin-queue.service.ts:276-295`

### P1-11 系统健康混入硬编码面板

- 数据库、Redis、对象存储探针和迁移是实时 API；3/3 up 可信。
- “队列与 Redis”面板固定 `Up · 2 ms`、`Key prefix roamlog`、`4 queues`，与真实配置和 5 个队列冲突。
- API/Worker 版本均为 `0.0.0`，来自未注入的 `npm_package_version`；“最近构建”实际是容器启动时间。
- Worker 假 DOWN 导致运维误判。
- 证据：`evidence/system.png`
- 代码：`apps/admin/components/system/system-view.tsx:154,164,176`、`apps/api/src/modules/admin/admin-system.service.ts:49`

### P1-12 生产数据存在 bootstrap 残留

- 2 个账号全部是管理员：1 个 `admin`、1 个 `super_admin`；0 个普通用户。
- `super_admin` 使用 `.local` 域；默认引导管理员未清理或改名。
- 19 个 Session、2 个 Account、1 个 TwoFactor；2 个免费/活跃 Workspace、2 条成员、1 次旅行。
- 没有大体积 fixture 数据；`DEMO_SEED_ENABLED=false`，Workspace/Trip 也不匹配 fixture 名称。因此结论是“bootstrap/测试残留”，不是完整演示种子。
- 这是发布治理问题，不应直接删除账号；需要负责人确认唯一管理员与恢复流程。

## 4. 逐页/逐控件矩阵

图例：`可用`=真实 API/交互正常；`可用(未提交)`=确认框可打开但本次因只读未提交；`预期禁用`=空数据/角色策略；`权限锁定`=API 模式由后端角色决定；`假实现`=fixture/硬编码；`未实现`=入口或能力缺失；`报错`=不可用。

### 4.1 登录、Shell 与跨页

| 页面 | 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|---|
| `/admin/login` | 邮箱/密码/TOTP | 可用，真实登录成功 | 真实认证 | `login-observations.json` | `login-panel.tsx` | — |
| `/admin/login` | 默认邮箱 | 预填 fixture 邮箱，和当前管理员不一致 | 不预填或仅开发环境预填 | 同上 | `login-panel.tsx:25` | P2 |
| 受保护路由 | 无会话访问 | 停留原路径，显示“需要重新登录”+按钮；不自动跳转 | 自动跳登录且保留 returnTo | `interaction-extra.json` | `mock-session-provider.tsx` | P2 |
| Shell | 环境徽标 | `LOCAL` 固定值 | 显示真实 `production/staging` | `navigation-mobile.png` | `mock-session-provider.tsx:93` | P1 |
| Shell | 2FA 状态 | 顶部 `2FA GATED`，侧栏 `2FA 已启用` | 单一真实状态 | 截图/HTML | `admin-topbar.tsx:123`、`admin-sidebar.tsx:127` | P1 |
| Shell | 平台角色选择 | 禁用，label“平台角色（后端）” | 保持后端权威 | `pages-observations.json` | `admin-sidebar.tsx` | 预期禁用 |
| Shell | 全局搜索按钮/⌘K | 打开正常；仅页面搜索 | 页面+用户+工作区或删除承诺 | 同上 | `admin-command-palette.tsx:153` | P1 |
| Shell | 通知按钮 | 打开 fixture 抽屉；badge=2 永远不变 | 真实通知/未读数 | 同上 | `admin-notifications-sheet.tsx` | P1 |
| Shell | 全部标为已读 | 仅本地 fixture，顶部 badge 不变，刷新恢复 | 持久化 mutation 或隐藏 | `interaction-extra.json` | 同上 | P1 |
| Shell | 返回登录占位 | 仅导航，不结束会话；Cookie 保留 | 调用 sign-out 并清理会话 | `interaction-extra.json` | `admin-sidebar.tsx:169` | P1 |
| Shell | 移动导航 | 可用，11 个链接 | 可用 | `navigation-mobile.png` | `admin-shell.tsx` | — |
| Shell | 面包屑/404 | 可用；未知路由 404 页面正常 | 可用 | `pages-observations.json` | `admin-nav.ts` | — |

### 4.2 总览

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 整页 | HTTP 500 错误边界 | 指标、趋势、审计可独立降级 | `dashboard-desktop.png` | `dashboard-view.tsx` | P0 |
| 重试 | 重发请求，仍 500 | 可恢复或明确阻断原因 | `interaction-extra.json` | `admin-data-boundary.tsx` | P0 |
| KPI | 数据请求 200，但被 audit 失败拖垮整页 | 局部错误提示，保留可用 KPI | `pages-observations.json` | `dashboard-view.tsx` | P1 |
| 趋势图 | 标题“12 天”；API 只有单次快照；无 7/30/90 天选择 | 真实时间序列与范围选择 | 静态代码 | `dashboard-view.tsx:103`、`trend-chart.tsx:73` | P1 |
| 邮件健康 | 只统计 delivered 等，遗漏 3 条 sent | 展示 sent/queued/delivered 全链路 | 生产库/`emails.png` | `admin-data-source.ts` | P2 |
| 最近审计 | 被 500 阻断 | 真实 recent events | 同上 | `dashboard-view.tsx` | P0 |

### 4.3 用户

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 搜索 | 本地过滤，2 条可选；无服务端搜索 | 服务端搜索或明确仅当前页 | `interaction-extra.json` | `users-view.tsx` | P2 |
| 状态/角色筛选 | 原生 select，本地过滤 | 可搜索下拉/服务端过滤 | `pages-observations.json` | `users-view.tsx` | P2 |
| 导出 CSV | 禁用，title=未接入 | 导出接口或移除 | `users.png` | `users-view.tsx:312` | P1 |
| 列表 | 2 条真实 API 数据；标注 Cursor Page 1 | 真实分页/总数 | `users.png` | `admin-data-source.ts:563` | P1 |
| 详情 | 抽屉打开；4 个体量字段均为 `—` | 真实会话/Workspace/内容体量 | `pages-observations.json` | `users-view.tsx:517` | P1 |
| 修改平台角色 | 确认框可用，`super_admin` 可操作；未提交 | 真实 mutation + audit | 同上 | `users-view.tsx:537` | 可用(未提交) |
| 暂停/恢复/删除 | 确认框可用，需输入目标名；未提交 | 真实 mutation + audit | 同上 | `users-view.tsx:547,567` | 可用(未提交) |
| 强制登出/重置 2FA | 按钮可用；未提交 | 真实 session/2FA mutation | 同上 | `users-view.tsx:695,706` | 可用(未提交) |
| 批量恢复/暂停/删除 | 批量条出现，确认框要求数量；未提交 | 真实批量 mutation | `interaction-extra.json` | `users-view.tsx:375` | 可用(未提交) |
| 排序/翻页/刷新 | 不存在 | 服务端排序、游标分页、刷新 | 控件扫描 | `users-view.tsx` | P1 |
| 新建/邀请用户 | 不存在 | 运营入口或明确非目标 | 导航 | — | P2 |

### 4.4 工作区

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 搜索/状态/套餐 | 本地过滤，2 条 | 服务端过滤或分页内过滤 | `workspaces.png` | `workspaces-view.tsx` | P2 |
| 活跃成员总量 | `—` | 真实计数 | `workspaces.png` | `admin-data-source.ts:254` | P1 |
| 列表体量列 | 成员/旅行/日志均为 `—` | 真实计数 | 同上 | `workspaces-view.tsx:558` | P1 |
| 详情 | 抽屉打开；成员明细缺失 | 成员、所有权、内容体量 | `pages-observations.json` | `workspaces-view.tsx:628` | P1 |
| 暂停/恢复/删除 | 确认框可用；未提交 | 真实 mutation + audit | 同上 | `workspaces-view.tsx` | 可用(未提交) |
| 批量操作 | 骨架存在；未提交 | 真实批量 mutation | 静态代码 | `workspaces-view.tsx` | 可用(未提交) |
| 套餐变更 | 无入口 | 运营变更+审计 | 控件扫描 | — | P1 |
| 所有权转移/成员管理 | 无入口 | 受控转移/成员治理 | 控件扫描 | — | P1 |
| 分页/排序/刷新 | 不存在 | DB 分页与排序 | 控件扫描 | `workspaces-view.tsx` | P1 |

### 4.5 内容审核

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 列表 | 1 条真实 Trip；Entry/Comment 为 0 | 真实三类内容 | `content.png` | `admin-data-source.ts:587-590` | 可用 |
| 搜索/类型/状态/可见性/Workspace | 本地过滤，原生 select | 服务端/可搜索 | `pages-observations.json` | `content-view.tsx` | P2 |
| 待审核举报 badge | 固定 0 | 真实举报计数 | `content.png` | `admin-data-source.ts:313,328,343` | P1 |
| `flagged` 筛选 | 无可产出数据的来源 | 举报/审核模型与队列 | 静态代码 | `content-view.tsx:257` | P1 |
| 详情 | 抽屉打开；举报字段来自固定值 | 真实作者/举报/历史 | 同上 | `content-view.tsx:512` | P1 |
| 删除/恢复 | 二次确认可用；未提交 | 真实 mutation + 证据链 | 同上 | `content-view.tsx` | 可用(未提交) |
| 批量删除/恢复 | 可用；未提交 | 真实批量 mutation | 静态代码 | `content-view.tsx:301` | 可用(未提交) |
| 公开分享 | 无分享时隐藏；有 token 时拼 localhost | 生产域名或隐藏 | 静态代码 | `content-view.tsx:527` | P1 |
| 分页/排序/刷新 | 不存在 | 服务端分页/排序 | 控件扫描 | `content-view.tsx` | P1 |

### 4.6 媒体

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 列表 | 真实 API 返回 0；空状态清晰 | 真实空状态 | `media.png` | `media-view.tsx` | 可用 |
| 存储桶名 | 固定 `roamlog-local` | 后端真实 bucket 或隐藏 | `media.png` | `media-view.tsx` | P1 |
| 搜索/状态/孤儿开关 | 本地过滤 | 服务端过滤 | 同上 | `media-view.tsx` | P2 |
| 预览/删除 | 无记录，未验证 | 真实图片与安全删除 | — | `media-view.tsx` | 未验证 |
| 上传 | 无入口（后台只读） | 若运营需要则补 | 导航 | — | P2 |
| 分页/排序 | 不存在 | DB 分页 | 控件扫描 | — | P2 |

### 4.7 审计日志

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 整页 | HTTP 500 | 真实审计列表 | `audit.png` | `admin-audit.service.ts`/presenter | P0 |
| 导出 | 页面不可达；共用 presenter 预计 500 | 可下载且脱敏 | 静态代码 | `admin-operations.controller.ts` | P1 |
| actor 筛选 | 使用 fixture 用户 | 真实管理员/actor 列表 | 静态代码 | `audit-view.tsx:45,264` | P1 |
| 日期筛选 | 原生 date input | 日期范围/时区说明 | 静态代码 | `audit-view.tsx` | P2 |
| 分页/排序 | 无；固定 100 | 游标分页 | 静态代码 | `admin-data-source.ts:620` | P1 |
| 空/错状态 | 500 错误页，无局部数据 | 错误原因与修复提示 | 截图 | `admin-data-boundary.tsx` | P1 |

### 4.8 功能开关

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 列表 | 0 条，只有标题/说明 | 空状态+新建 | `flags.png` | `flags-view.tsx` | P1 |
| 新建/删除 | 不存在 | 创建/删除+审计 | API 路由 | `admin-operations.controller.ts:65-78` | P1 |
| 启用/灰度/白名单 | 有数据时可用；当前未验证 | 真实 mutation | 静态代码 | `flags-view.tsx` | 未验证 |
| 保存校验/错误 | 有 status/错误提示 | 保持 | 静态代码 | 同上 | 可用 |
| 未保存离开提醒 | 无 | 防误切页 | 静态代码 | 同上 | P2 |

### 4.9 邮件

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 列表 | 3 条真实 `sent` 日志 | 真实 Resend 状态 | `emails.png` | `emails-view.tsx` | 可用 |
| 送达统计 | delivered/bounced/complained/failed 全 0，未展示 sent | 完整状态漏斗 | 同上 | `emails-view.tsx` | P2 |
| 搜索/状态/模板 | 本地过滤，原生 select | 服务端/可搜索 | `pages-observations.json` | 同上 | P2 |
| 测试邮件 | 禁用，API 无契约 | 真实测试入口或移除 | `emails-view.tsx:195` | 同上 | P1 |
| 重发 | 所有 sent 行都可用，未限制失败状态 | 仅失败/退信可重发 | `emails.png` | `emails-view.tsx:369` | P1 |
| 邮件实际传输 | Mailpit | 生产 Resend/SMTP | `production-facts.json` | compose/API | P0 |
| 分页/排序/刷新 | 不存在 | 服务端分页 | 控件扫描 | `emails-view.tsx` | P2 |

### 4.10 队列

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| 5 个队列计数 | 真实 Redis 计数；全 0 | 真实 | `queues.png` | `admin-queue.service.ts` | 可用 |
| 吞吐 | 固定 0.0 jobs/min | 计算窗口吞吐或显示 N/A | `admin-data-source.ts:410` | `queues-view.tsx` | P1 |
| “跨四个队列” | 实际 5 个 | 动态计数 | `queues.png` | `queues-view.tsx:241` | P1 |
| 健康 badge | 依计数推导，忽略 Worker down | 真实 worker/queue 健康 | `queues.png` | `queues-view.tsx` | P1 |
| 失败任务列表 | 0 条，空状态清楚 | 真实失败明细 | `queues.png` | `queues-view.tsx` | 可用 |
| 暂停/恢复/清空 | 二次确认可用；未提交 | 真实操作+审计 | 静态代码 | `queues-view.tsx` | 可用(未提交) |
| 重试失败任务 | 无数据，按钮不可见 | 可重试 | 控件扫描 | `queues-view.tsx` | 未验证 |
| 分页/筛选 | 失败日志最多 100；无翻页 | 游标分页 | `admin-data-source.ts:660` | — | P2 |

### 4.11 系统健康

| 控件/区域 | 现状 | 期望 | 证据 | 涉及文件 | 级别 |
|---|---|---|---|---|---|
| DB/Redis/Storage | 3/3 up，真实探针 | 保持 | `system.png` | `admin-system.service.ts` | 可用 |
| 迁移状态 | 真实 migration | 保持 | 同上 | 同上 | 可用 |
| API/Worker 版本 | `0.0.0` | 镜像/构建版本 | 同上 | `admin-system.service.ts:49` | P1 |
| Worker 状态 | API 报 DOWN/0 consumers；容器 healthy | 真实 worker heartbeat | `system.png`+`production-facts.json` | `admin-queue.service.ts:276` | P1 |
| 队列与 Redis 面板 | `Up · 2 ms`、key prefix、4 queues 硬编码 | 全部来自 API | `system.png` | `system-view.tsx:164,176` | P1 |
| 最近构建 | 显示容器启动时间 | 真实 build time | `system.png` | `admin-system.service.ts` | P2 |
| 刷新 | 无入口 | 手动刷新/自动轮询 | 控件扫描 | `system-view.tsx` | P2 |

### 4.12 跨页表单、规模与可访问性

| 项目 | 现状 | 缺口 | 级别 |
|---|---|---|---|
| 下拉搜索 | 所有筛选均为原生 `<select>`，没有 combobox/输入过滤 | 数据量增大后不可用；当前 2–7 个选项尚可 | P2 |
| 日期/时间 | 审计使用原生 date；其余页面无日期控件 | 无范围选择器、时区提示、快捷范围 | P2 |
| 必填/校验 | 危险操作要求输入目标名/数量，确认按钮初始禁用 | 真实；但提示文案错误 | 可用 |
| 危险确认 | 用户/工作区/内容/队列均有二次确认，红色样式 | 未提交验证；文案需修正 | 可用(未提交) |
| 分页 | 所有列表固定 `limit: 100`，无游标 UI | 超过 100 条静默截断 | P1 |
| 排序 | 所有表头不可排序 | 运营无法按风险/时间排序 | P1 |
| 刷新 | 除错误重试外无刷新按钮 | 数据易过期 | P2 |
| 导出 | 仅审计（当前 500）；用户导出禁用 | 运营数据出口不足 | P1 |
| 焦点 | 9/10 个 Tab 停止点有可见 box-shadow；跳至主要内容链接无可见 outline | 键盘用户可能迷失 | P2 |
| 对比度 | axe WCAG 2.1 A/AA：10 页+移动端 0 violations | 自动扫描通过；仍需人工视觉复核 | — |
| 窄屏 | 390px 无页面级横向溢出；表格在 356px 容器内滚动，内容宽 1040px | 操作列在右侧，无滚动提示 | P2 |
| 空/错/加载 | 媒体/队列空状态清楚；用户/工作区错误边界；总览/审计整页错误 | 功能开关无空状态；错误粒度粗 | P1 |

## 5. 死按钮/假按钮清单

没有发现“JSX 已渲染但 onClick 完全未绑定”的字面死按钮。用户感受到的“点不了”主要来自：

| 控件 | 实际行为 | 分类 | 证据 |
|---|---|---|---|
| 通知 › 全部标为已读 | 只改本地 fixture，顶部未读数不变；刷新恢复 | 假实现 | `interaction-extra.json` |
| 返回登录占位 | 仅跳到登录页，不 sign-out；Cookie 保留 | 假登出 | `interaction-extra.json` |
| 总览 › 重试 | 发请求但仍是 500，无恢复路径 | 无效恢复 | `interaction-extra.json` |
| 用户 › 导出 CSV | `disabled`，title 未接入 | 未实现 | `users.png` |
| 邮件 › 测试邮件 | `disabled`，API 无入口 | 未实现 | `emails.png` |
| 审计日志入口 | 页面 500，所有页面内操作不可达 | 报错 | `audit.png` |
| 内容 › 待审核举报 | `0 reports` 固定；`flagged` 没有数据源 | 假实现 | `content.png` |
| 全局搜索用户/工作区 | 文案承诺，API 模式无实体结果 | 部分实现 | `admin-command-palette.tsx` |
| 功能开关新建 | 无入口；零数据页面无 CTA | 未实现 | `flags.png` |
| 角色模拟下拉 | API 模式禁用 | 预期禁用/文案误导 | `navigation-mobile.png` |
| 队列清空 | 0 任务时禁用 | 预期禁用 | `queues.png` |

## 6. 假数据与假文案清单

| 位置 | 假数据/假文案 | 真实来源 |
|---|---|---|
| Shell 环境徽标 | `LOCAL` | `/admin/system` 显示 `PRODUCTION` |
| Shell 2FA | `2FA GATED` + `2FA 已启用` 同时出现 | 登录已通过 TOTP；session provider 固定 false |
| 通知 | fixture 通知、固定 2 条未读 | `Notification=0` |
| 全局搜索页脚 | `Fixture search boundary` | API 模式 |
| 危险确认框 | “当前没有连接真实 API” | 实际已调用真实 `/v1` |
| 总览趋势 | `GROWTH / 12 DAYS`、12 日趋势图 | metrics 只有一次聚合快照 |
| 内容举报 | `0 reports`、举报列、flagged 筛选 | 无 Report 模型/API |
| 媒体桶名 | `roamlog-local` | 生产存储桶名 |
| 系统 Redis 面板 | `Up · 2 ms`、`Key prefix roamlog`、`4 queues` | 实际 5 个队列；未从 API 读取 |
| 队列吞吐 | 所有队列 `0.0 jobs/min` | mapper 固定 0 |
| 队列标题 | “跨四个队列” | 页面 5 个队列 |
| 登录页 | 预填 fixture 邮箱 | 当前管理员是另一账号 |
| 内容分享 | `http://localhost:3000/share/...` | 生产域名 |
| 用户/工作区体量 | 0 经 UI 显示为 `—` | API 未提供计数（不是“真实 0”） |

## 7. 生产数据与安全检查

### 7.1 数据画像（只报告数量/类型）

| 表 | 数量 |
|---|---:|
| User | 2 |
| Workspace | 2 |
| WorkspaceMember | 2 |
| Trip | 1 |
| TripParticipant | 1 |
| JournalEntry | 0 |
| Comment | 0 |
| Media | 0 |
| Invitation | 0 |
| Notification | 0 |
| AuditLog | 5 |
| EmailLog | 3 |
| FeatureFlag | 0 |
| TwoFactor | 1 |
| Session | 19 |
| Account | 2 |
| Activity | 1 |
| ShareLink | 0 |
| Export | 0 |

分类：

- 平台角色：`admin=1`、`super_admin=1`，普通用户 0。
- 1 个 `super_admin` 使用 `.local` 域，属于 bootstrap 残留风险。
- 2 个 Workspace 均为 `free`/`active`；无演示 slug 命中。
- EmailLog 全部为 3 条 `sent`：1 条重置密码、2 条邮箱验证；无 delivered webhook。
- AuditLog：2 条 bootstrap、2 条 workspace onboarded、1 条 user updated；其中 user updated 为主键 UUIDv4。
- 不存在 `%report%` 表；举报/审核数据模型确实缺失。

### 7.2 开发后门/环境

- `NEXT_PUBLIC_ADMIN_DATA_MODE=api`，前端走真实 `/v1`。
- `DEMO_SEED_ENABLED=false`。
- `/v1/docs`、`/docs`、`/v1/metrics` 均 404。
- `/v1/health`、`/v1/health/live`、`/healthz` 为 200，未发现调试入口。
- 配置目录 `700 root:root`；环境文件与管理员凭据均 `600 root:root`。
- **但当前 compose 名/数据库/Redis 前缀均为 `staging`，同时包含 Mailpit；API 的 `NODE_ENV` 却是 `production`。环境和发布身份不干净。**

## 8. 同域、路由、会话与网络

| 检查项 | 结果 | 证据 |
|---|---|---|
| `/admin` 刷新 | 200，应用壳正常 | `pages-observations.json` |
| 10 个后台路由刷新 | 全部 200，客户端接管 | 同上 |
| 未知路由 | 自定义“页面不存在”404 | 同上 |
| 静态资源 | 14 JS + 4 CSS，全部 `/admin-assets/`，0 失败 | 同上 |
| API 路径 | 同域 `/v1`；`/v1/me` 200 | 同上 |
| WebSocket | 未观察到连接 | `interaction-extra.json` |
| 登录跳转 | 显式按钮可到 `/admin/login`；无自动 redirect | 同上 |
| 会话 Cookie | Secure、HttpOnly、SameSite=Lax | 同上 |
| 登出 | 无 sign-out 请求，会话保留 | 同上 |
| 安全头 | HSTS、CSP、nosniff、DENY、no-referrer 均存在 | `production-facts.json` |
| 控制台 | CSP 阻止 Cloudflare Insights beacon；500 页另有资源错误 | `pages-observations.json` |
| HTML 缓存 | `/admin`、`/admin/users` 返回 `s-maxage=31536000` + `x-nextjs-cache: HIT` | `production-facts.json` |

缓存风险：虽然 Cloudflare 当前返回 `cf-cache-status: DYNAMIC`，但一年期共享缓存策略不适合频繁发布的 Admin 壳；应在发布后主动 purge，或改为短缓存/部署 ID 失效。

## 9. 视觉与可用性

- 桌面端整体保持真黑画布、hairline、mono 元数据和紧凑工作型布局，视觉方向与产品基线一致。
- 总览/审计错误页占满主内容区，但导航仍可用；用户会认为“后台坏了”，与实际一致。
- 移动端 390px 无页面级横向溢出；用户/内容表格在 356px 容器内横向滚动，内容宽 1040px。操作列位于最右，首屏不可见且没有滚动提示。
- 移动导航抽屉可用（11 个链接），但环境 `LOCAL`、2FA 错误仍同步显示。
- 媒体、队列空状态清楚；功能开关零数据时没有任何空状态或 CTA，像“没加载出来”。
- 自动化 axe：10 个桌面页面 + 用户移动页，WCAG 2.1 A/AA 0 violations。
- 键盘：10 次 Tab 中 9 个有可见 focus ring；“跳至主要内容”链接无可见 outline。
- 表格首列/名称在审计截图中已脱敏；截图不包含生产个人信息。

## 10. 修复任务拆分（按文件边界）

以下均为建议任务，本次未修改产品代码。

| Task ID | 角色 | 目标与边界 | 允许文件 | 验收命令 |
|---|---|---|---|---|
| `admin_p0_audit_contract` | backend_api | 修复 UUIDv4 审计记录兼容/迁移；禁止单条坏数据拖垮整页；补回归测试 | `apps/api/src/modules/admin/admin-audit.service.ts`、`admin.presenters.ts`、`apps/api/src/modules/admin/__tests__/*audit*`、`packages/db/prisma/migrations/*` | `pnpm --filter @roamlog/api test`; `pnpm --filter @roamlog/api typecheck` |
| `admin_p0_email_environment` | devops | 拆分 production/staging compose；生产移除 Mailpit；配置 Resend/SMTP 并验证域名、SPF/DKIM；环境徽标使用真实值 | `docker/compose.production.yml`（新建）、`docker/.env.production.example`、部署文档；不改业务代码 | `pnpm staging:validate`; 生产只读 `/v1/admin/system` 检查；Mailpit 不存在 |
| `admin_dashboard_resilience` | web_frontend | 三个资源独立错误边界；趋势改为真实时间序列或显示 N/A；7/30/90 范围；邮件 sent 指标 | `apps/admin/components/dashboard/*`、`apps/admin/lib/admin-data-source.ts`、对应测试 | `pnpm --filter @roamlog/admin test`; `pnpm --filter @roamlog/admin typecheck` |
| `admin_shell_truth` | web_frontend | 从 session/API 推导 environment/2FA；真实登出；移除 fixture 通知或接真实 API；搜索范围与文案一致 | `apps/admin/components/admin-shell/*`、`apps/admin/lib/admin-paths.ts`、`apps/admin/components/login/*` | `pnpm --filter @roamlog/admin test`; `pnpm e2e:admin` |
| `admin_users_detail` | backend_api + web_frontend | 用户详情计数/会话/Workspace、服务端搜索/分页、导出 | `packages/contracts/src/api/admin.ts`、`apps/api/src/modules/admin/admin-users.*`、`apps/admin/components/users/*`、`apps/admin/lib/admin-data-source.ts` | `pnpm contracts:check`; API/admin tests |
| `admin_workspaces_detail` | backend_api + web_frontend | 成员/旅行/日志计数、成员明细、套餐变更、所有权转移、分页 | contracts、`admin-workspaces.*`、`workspaces-view.tsx` | `pnpm contracts:check`; API/admin tests |
| `admin_moderation_reports` | architect + backend + web | 新增 Report/Moderation 模型/API/队列/详情/裁决；禁止硬编码 0；修复分享域名 | contracts、Prisma schema/migration、`apps/api/src/modules/admin/*content*`、`content-view.tsx` | migration on empty+existing DB; API/E2E |
| `admin_audit_filters` | web_frontend | 真实 actor 列表、日期范围、分页、导出错误恢复 | `audit-view.tsx`、`admin-data-source.ts` | admin tests; live audit 200 |
| `admin_flags_admin` | backend + web | 创建/删除/空状态；seed 或显式“无开关”；校验未保存离开 | contracts、`feature-flags/*`、`flags-view.tsx` | API/admin tests; mutation audit |
| `admin_email_safety` | backend + web | 仅失败/退信可重发；补测试邮件契约或移除按钮；展示 sent/queued；Resend webhook 验证 | `admin-emails.service.ts`、emails contracts、`emails-view.tsx`、worker | API tests; webhook E2E |
| `admin_queue_truth` | backend + web | 真实吞吐、worker heartbeat、队列健康；动态队列数；统一 5 队列 | `admin-queue.service.ts`、`admin-metrics.service.ts`、`queues-view.tsx`、`system-view.tsx` | API tests; live system cross-check |
| `admin_ops_hygiene` | devops | 清理/确认 `.local` super_admin；发布缓存/部署 ID；CSP 允许或移除 CF beacon；移动滚动提示 | 运维配置/`apps/admin/next.config.ts`/样式 | `pnpm e2e:a11y:axe`; visual checks |

## 11. 证据路径

报告与证据均在 `.audit/`：

- 本报告：`.audit/2026-11-18-admin-prod-audit.md`
- 页面/API/控件观测：`.audit/2026-11-18-admin-prod-audit/evidence/pages-observations.json`
- 登录/会话观测：`.audit/2026-11-18-admin-prod-audit/evidence/login-observations.json`
- 登录后额外交互：`.audit/2026-11-18-admin-prod-audit/evidence/interaction-extra.json`
- axe 结果：`.audit/2026-11-18-admin-prod-audit/evidence/axe-results.json`
- 生产事实：`.audit/2026-11-18-admin-prod-audit/evidence/production-facts.json`
- 截图：`dashboard-desktop.png`、`users.png`、`workspaces.png`、`content.png`、`media.png`、`audit.png`、`flags.png`、`emails.png`、`queues.png`、`system.png`、`users-mobile.png`、`navigation-mobile.png`、`content-mobile.png`、`queues-mobile.png`、`dashboard-mobile.png`

## 12. 未验证项与限制

- 未提交写操作：用户角色/暂停/删除、工作区暂停/删除、内容删除/恢复、批量操作、功能开关保存、邮件重发、队列暂停/清空/重试、强制登出、重置 2FA。
- 因此这些 mutation 的**权限拒绝、幂等、审计落库与失败回滚**未做端到端验证；只确认了确认框和 API 绑定存在。
- 用户导出内容未下载（避免 PII），且按钮禁用。
- 审计导出未下载（避免 PII，且页面/接口 500）。
- 邮件只确认配置与数据库状态；未向真实外部地址发信。
- 媒体预览/删除、Entry/Comment 审核无生产记录可点。
- 低权限角色（support/analyst/admin）未用独立账号实测；仅静态检查权限分支。
- 会话真正过期/轮换未等待 TTL；只验证了无会话与“假登出”场景。
- 视觉复核基于 1440×1000 与 390×844；未覆盖 768/1024 断点。

## 13. 子 Agent 交付格式

```text
状态: DONE
任务 ID: /root/audit_prod_admin
变更文件:
- .audit/2026-11-18-admin-prod-audit.md
- .audit/2026-11-18-admin-prod-audit/evidence/*（JSON/PNG，均脱敏）
实现摘要:
- 完成 10 个 Admin 路由、Shell、登录/2FA、列表、详情、筛选、确认框、批量、队列、邮件、媒体、系统健康审计。
- 结论：2 个 P0 + 多个 P1；权限不是主要阻断；发布判定 BLOCKED。
验证命令与结果:
- 浏览器：1440×1000 + 390×844，10 页，223 个控件实例，17 个禁用。
- axe WCAG 2.1 A/AA：10 桌面页 + 移动用户页 0 violations。
- 同域：10 路由 200；14 JS + 4 CSS 全 200；未知路由 404；0 WebSocket。
- 生产只读：Postgres/Redis/容器/配置检查完成；未执行业务 mutation。
截图/日志/接口证据:
- .audit/2026-11-18-admin-prod-audit/evidence/
已知风险:
- 总览/审计 500；生产 URL 使用 staging compose + Mailpit；假登出；多处 fixture/硬编码。
未覆盖项:
- 所有业务写操作、真实外部发信、低权限角色、会话 TTL、媒体预览。
建议的下一步:
- 先修 P0-01/P0-02，再按第 10 节拆分返工；完成后重跑 admin E2E、axe、live E2E 与生产只读核验。
```

**发布验收结论：BLOCKED。** 审计任务本身已完成；在生产修复 P0-01 与 P0-02 前，不应将当前后台视为可交付生产运营台。
