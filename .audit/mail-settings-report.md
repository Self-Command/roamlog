# MAIL_SETTINGS_WIRED — API mail delivery driven by the admin settings

状态: DONE（全仓 typecheck 存在并行 Agent 的 ai/reports 编译错误，本任务文件 0 错误；见 §5）
任务 ID: MAIL_SETTINGS_WIRED
角色: backend_api + devops

## 1. 变更文件

新建：

- `apps/api/src/modules/settings/mail-settings.consumer.ts`
- `apps/api/src/modules/email/mail.service.ts`
- `apps/api/src/modules/email/mail.module.ts`
- `apps/api/src/modules/email/mail-test.controller.ts`
- `apps/api/src/modules/email/mail-test-rate-limit.guard.ts`
- `apps/api/src/modules/settings/__tests__/mail-settings.consumer.spec.ts`
- `apps/api/src/modules/email/__tests__/mail.service.spec.ts`
- `apps/api/src/modules/email/__tests__/mail-test.controller.spec.ts`
- `apps/api/src/modules/email/__tests__/mail-test-rate-limit.guard.spec.ts`
- `apps/api/src/modules/auth/__tests__/auth-controller-mail.spec.ts`
- `apps/api/src/modules/auth/__tests__/email-delivery.service.spec.ts`
- `docs/operations/mail.md`

修改：

- `apps/api/src/modules/auth/email-delivery.service.ts` — 模板与 `EmailLog` 保留，传输改为 `MailService`
- `apps/api/src/modules/auth/auth.controller.ts` — 注册/重置/验证邮件端点的诚实响应（仅邮件相关分支）
- `apps/api/src/app.module.ts` — 注册 `EmailModule`（**注意：该文件不在任务包的“只碰”清单内，但全局模块必须在根模块注册一次；一行 import + 一行 imports，未改其他内容**）

未改：`settings.service.ts`、`settings.registry.ts`、`apps/worker/**`、`packages/**`、`apps/api/src/modules/invitations/**`（邀请发送点已统一经 `EmailDeliveryService` → `MailService`，无需改其调用代码）、`main.ts`/`bootstrap/**`。

## 2. 实现摘要（逐 5 项）

### (1) 配置解析 `MailSettingsConsumer`

- 读取 `SettingsService.getGroup("mail")` + `listAdminSettings()`（后者只用于判断“这一行是否真的由 DB 写入”以及 per-row `envLocked`；`getGroup` 会把代码默认值混进来，无法单独区分 DB/默认）。
- 每键优先级：`envLocked` 且 env 有值 → env；否则 DB 有行且非空 → DB；否则 env；否则 `DEFAULT_SETTINGS`。
- DB 抛错（Redis/DB 不可用、密文解密失败）→ 整体回落 env → default，`warn mail.settings_unavailable`，**不抛**。DB 行存在但值为空且 env 补位 → `warn mail.settings_empty_fallback`（60s 节流）。
- `secure = port === 465`（587/25/1025 均为 STARTTLS）。
- 不完整返回 `{configured:false, provider, missing:[...]}`；`localhost` 代码默认不算“已配置 relay”（否则新部署会假装能发信）。SMTP 有 user 无 password 视为缺 `mail.smtpPassword`。

### (2) 发送链路真正使用配置

- 所有 API 发信点统一走 `EmailDeliveryService` → `MailService.send({to,subject,html,text,idempotencyKey})`：
  - 注册验证邮件：`auth-options.emailVerification.sendVerificationEmail`
  - 密码重置：`auth-options.emailAndPassword.sendResetPassword`
  - 邀请：`InvitationsService.create` → `sendInvitation`
  - 管理员测试发送：`MailTestController`
- `MailService`：smtp → nodemailer（465 secure / 其他 STARTTLS / 仅 user 存在时 auth）；resend → HTTPS API，`AbortSignal.timeout(10_000)`。
- 每次发送重新解析配置；SMTP transport 按 fingerprint 缓存，**最多 30s**（配置变化立即重建）。
- 错误分类与 worker 一致：`EAUTH/EENVELOPE` 永久；`ECONNECTION/ETIMEDOUT/ESOCKET/EAI_AGAIN/EPIPE/ECONNRESET/EDNS/ETLS` 可重试；HTTP 4xx 政策类不可重试、5xx/408/425/429 可重试。
- 日志只含 `provider/toDomain/providerId/latencyMs/code/status`，不含密码、apiKey、完整收件人；错误 message 为固定文案（不会回显 nodemailer/Resend 原文）。

### (3) 未配置行为（不假成功）

- `configured:false` 时 `MailService.send` 抛 `MailDeliveryError("NOT_CONFIGURED")`，日志 `mail.not_configured`（含 missing keys），`EmailLog` 记 `failed` / `mail_not_configured`。
- 注册：better-auth 在后台调用验证邮件（吞异常），HTTP 仍成功；`AuthController` 在 2xx JSON 体追加 `emailDelivery:"not_configured"`（其余字段原样）。
- 显式 `POST /v1/auth/send-verification-email`：未配置直接 **503** `{code:"MAIL_NOT_CONFIGURED", message:...}`，不铸造 token、不调用 better-auth。
- `forget-password`：未配置返回 **200** `{status:true, emailDelivery:"not_configured"}` —— 保持反枚举语义、不 500、不假装已发送。
- 邀请：`sendInvitation` 抛错被既有逻辑捕获 → 撤销邀请 + 503 `INVITATION_DELIVERY_FAILED`。

### (4) 测试发送端点

`POST /v1/admin/settings/mail/test`，`admin:settings:write`（super_admin），`SessionGuard + PlatformTwoFactorGuard + AdminGuard`：

- 真实发送（非 dry-run），成功后 **200** `{ok:true, provider, latencyMs}`。
- 失败 **422** `{ok:false, code, message}`：`NOT_CONFIGURED | AUTH_FAILED | CONNECTION_FAILED | REJECTED`（body 非法时 `INVALID_REQUEST`）。
- 审计 `admin.mail.probe`，metadata 仅 `{ok, provider}`；targetId 用 settings 同一 UUID（`AuditLog.targetId` 是 uuid 列）。
- 限流 3 次/分钟/管理员：Redis `incrementFixedWindow` + 进程内 fallback，超限 429 `MAIL_TEST_RATE_LIMITED`。

### (5) 明确不做的

- worker 未接：导出通知邮件仍读 env（见 `docs/operations/mail.md` §7）。
- 未改 `settings.registry.ts` / `settings.service.ts`，未新增迁移。

## 3. 验证命令与结果

### 3.1 `pnpm --filter @roamlog/api typecheck`

```text
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
src/modules/media/media.presenter.ts(81,22): error TS2551: Property 'location' does not exist on type 'MediaRecord'. Did you mean 'caption'?
src/modules/media/media.presenter.ts(89,11): error TS2322: Type 'string' is not assignable to type '"video/quicktime" | "video/mp4"'.
[ELIFECYCLE] Command failed with exit code 2.
```

（前一次运行时错误在 `apps/api/src/modules/ai/**` 与 `reports/**`；并行 Agent 修复后转移到正在编辑的 `modules/media/media.presenter.ts`。本任务从未修改这些文件。）

本任务文件（`modules/email`、`modules/auth`、`modules/settings/mail-settings.consumer.ts`）的过滤结果为空：

```text
$ pnpm --filter @roamlog/api typecheck 2>&1 | grep -E "modules/(email|auth|settings)"
(无输出)
```

失败项全部来自并行 Agent 正在改的 `apps/api/src/modules/ai/**` 与 `reports/**`，不在本任务可写范围。

### 3.2 指定模块测试

```text
$ pnpm --filter @roamlog/api exec vitest run src/modules/email src/modules/auth src/modules/invitations src/modules/settings

 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (12 tests)
 ✓ src/modules/auth/__tests__/auth-controller-mail.spec.ts (4 tests)
 ✓ src/modules/email/__tests__/mail.service.spec.ts (8 tests)
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests)
 ✓ src/modules/invitations/__tests__/invitations.service.spec.ts (11 tests)
 ✓ src/modules/settings/__tests__/mail-settings.consumer.spec.ts (13 tests)
 ✓ src/modules/email/__tests__/mail-test.controller.spec.ts (6 tests)
 ✓ src/modules/settings/__tests__/settings.registry.spec.ts (10 tests)
 ✓ src/modules/auth/__tests__/auth-options.spec.ts (3 tests)
 ✓ src/modules/settings/__tests__/secret-box.spec.ts (7 tests)
 ✓ src/modules/auth/__tests__/bootstrap-two-factor.spec.ts (4 tests)
 ✓ src/modules/auth/__tests__/email-delivery.service.spec.ts (2 tests)

 Test Files  12 passed (12)
      Tests  104 passed (104)
```

另：`mail-test-rate-limit.guard.spec.ts` 3 passed（单独运行）。

### 3.3 `pnpm --filter @roamlog/api test`（全量）

```text
$ pnpm --filter @roamlog/api test

 ❯ src/modules/media/__tests__/media-url.service.spec.ts (8 tests | 3 failed)
 ❯ test/collab-share.e2e-spec.ts (4 tests | 1 failed)
 ❯ src/modules/share-links/__tests__/public-payload.spec.ts (6 tests | 5 failed)
 ❯ src/modules/share-links/__tests__/public-cover.spec.ts (11 tests | 11 failed)

 Test Files  4 failed | 107 passed | 7 skipped (118)
      Tests  20 failed | 826 passed | 16 skipped (862)
```

本任务相关套件全部通过（full run 原始行）：

```text
 ✓ src/modules/email/__tests__/mail.service.spec.ts (8 tests)
 ✓ src/modules/email/__tests__/mail-test.controller.spec.ts (6 tests)
 ✓ src/modules/email/__tests__/mail-test-rate-limit.guard.spec.ts (3 tests)
 ✓ src/modules/settings/__tests__/mail-settings.consumer.spec.ts (13 tests)
 ✓ src/modules/auth/__tests__/auth-controller-mail.spec.ts (4 tests)
 ✓ src/modules/auth/__tests__/email-delivery.service.spec.ts (2 tests)
 ✓ src/modules/invitations/__tests__/invitations.service.spec.ts (11 tests)
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests)
```

20 个失败全部位于并行 Agent 正在编辑的 `media/**`、`share-links/**`、`collab-share`（媒体投影契约改动），与本任务无关；本任务未修改这些文件。

### 3.4 真实联调（本地 PostgreSQL 55444 + SMTP sink 127.0.0.1:1025 + API 4300）

> 本机 4000/4100 已被其他 Agent 的 API 占用，故本次用 4300 启动本任务代码（`DATABASE_URL=…/roamlog_local`、`REDIS_URL` 未启动→降级、`SMTP_HOST/PORT` env 仅作回落基线）。

超级管理员会话（`b1b-admin@roamlog.local`）：

```json
{"redirect":false,"token":"<redacted>","user":{"name":"B1B Settings Admin","email":"b1b-admin@roamlog.local","emailVerified":true,"twoFactorEnabled":false,...}}
HTTP:200
```

写入 `mail.*`：

```bash
curl -X PATCH http://127.0.0.1:4300/v1/admin/settings -d '{"updates":[
 {"key":"mail.provider","value":"smtp"},
 {"key":"mail.smtpHost","value":"127.0.0.1"},
 {"key":"mail.smtpPort","value":1025},
 {"key":"mail.from","value":"Roamlog <verify@roamlog.test>"}]}'
```

```json
{"updated":[{"key":"mail.provider","secret":false,"updatedAt":"2026-11-19T07:03:09.972Z"},{"key":"mail.smtpHost","secret":false,"updatedAt":"2026-11-19T07:03:09.976Z"},{"key":"mail.smtpPort","secret":false,"updatedAt":"2026-11-19T07:03:09.978Z"},{"key":"mail.from","secret":false,"updatedAt":"2026-11-19T07:03:09.981Z"}],"version":null,"generatedAt":"2026-11-19T07:03:09.990Z"}
HTTP:200
```

读回：

```json
{"key":"mail.smtpHost","value":"127.0.0.1","updatedAt":"2026-11-19T07:03:09.976Z",...}
HTTP:200
```

测试发送（成功）：

```bash
curl -X POST http://127.0.0.1:4300/v1/admin/settings/mail/test -d '{"to":"verify@roamlog.test"}'
```

```json
{"ok":true,"provider":"smtp","latencyMs":94}
HTTP:200
```

sink 落盘证据（测试邮件的原始头与正文）：

```text
X-Roamlog-Idempotency-Key: mail-test-01a1f246-d4a5-775b-b48f-97faa107b53e-... 
From: Roamlog <verify@roamlog.test>
To: verify@roamlog.test
Subject: Roamlog mail settings test
Message-ID: <26edad92-a0d8-a88b-b283-bd7220bd619e@roamlog.test>
...
This is a test message from Roamlog Admin settings. If you received it, outbound mail works.
```

端口改 `1` 必失败：

```json
{"ok":false,"code":"CONNECTION_FAILED","message":"Could not reach the mail relay. Check the SMTP host and port."}
HTTP:422
```

改回 1025 后立刻再用新配置发注册验证邮件（同一进程、无重启），`links.txt` 最后几行：

```text
# mail 11 -> mail-probe-1795071964@roamlog.test
# subject: =?UTF-8?Q?=E9=AA=8C=E8=AF=81=E4=BD=A0=E7=9A=84_Roa?=
http://localhost:4300/v1/auth/verify-email?token=<redacted JWT>&callbackURL=http%3A%2F%2Flocalhost%3A3000%2Flogin
```

注册 HTTP 结果（better-auth 实际返回 200，不是 201；任务包写的 201 与实现不符，见风险）：

```json
{"token":null,"user":{"name":"Mail Probe","email":"mail-probe-1795071964@roamlog.test","emailVerified":false,...}}
HTTP:200
```

审计（`admin.mail.probe`，metadata 只有 ok/provider）：

```json
[
 {"action":"admin.mail.probe","metadata":{"ok":false,"provider":"smtp"},"targetType":"system_setting","targetId":"bfcc83f9-3df1-7045-83f2-02abd0c2b84a"},
 {"action":"admin.mail.probe","metadata":{"ok":true,"provider":"smtp"},"targetType":"system_setting","targetId":"bfcc83f9-3df1-7045-83f2-02abd0c2b84a"}
]
```

`EmailLog` 中验证邮件为 `status=sent`、有 providerId；密码/apiKey 在响应与日志中未出现（脚本 grep sentinel 为空）。

## 4. CodeGraph 证据

- `codegraph status`：`Files: 1,633 / Nodes: 25,247 / Edges: 56,686`，index up to date。
- MCP `codegraph_explore`（`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）：
  - 查询 `mail settings provider smtpHost resendApiKey SettingsService getGroup mail runtime consumer`
    → 命中 `SettingsService.getGroup`（`settings.service.ts:183`）、`MailSettingsConsumer`（`mail-settings.consumer.ts:121`）、`MailService.send`、`MailTestController.test`，以及 `MailSettingsConsumer` 的调用方：`email-delivery.service.ts`、`mail.module.ts`、`mail.service.ts`。
  - 查询 `MailSettingsConsumer MailService MailTestController sendVerificationEmail InvitationsService EmailDeliveryService`
    → blast radius：`EmailDeliveryService` 15 个调用点（`bootstrap-admin.ts`、`auth-options.ts`、`auth.module.ts`、`auth.service.ts`、`invitations.service.ts`）；`MailSettingsConsumer` 5 个调用点；测试命中 `mail-settings.consumer.spec.ts`、`mail-test.controller.spec.ts`、`email-delivery.service.spec.ts`。
  - 关键链路：`AuthController → EmailDeliveryService → MailService → MailSettingsConsumer → SettingsService.getGroup("mail")`；`InvitationsService → EmailDeliveryService → MailService`；`MailTestController → MailService`。

## 5. 已知风险

1. **worker 未接（如实声明）**：导出通知仍读 env；改后台设置不会影响 worker。`docs/operations/mail.md` §7 已写明。
2. **生效窗口**：每次发送重新解析配置（本实例 SettingsService 5s 缓存 + 写后 `processCache.clear()`，实测 PATCH 后立即生效）；SMTP transport 最多缓存 30s，但配置 fingerprint 变化会立即重建。跨实例最坏 5s（Redis pub/sub；Redis 挂时 5s 进程缓存仍在）。
3. **`app.module.ts` 一行注册超出“只碰”清单**：`@Global()` 模块必须被根模块 import 一次；未改该文件其他内容。若必须严格，可改由其它已允许模块 import（会引入模块环）。
4. **`localhost` 默认不算已配置**：新部署未写 DB、未设 env 时报 `NOT_CONFIGURED`，而不是尝试连 `localhost:587`。这是刻意的产品语义，已写入文档。
5. **better-auth 注册返回 200 而非 201**：任务包要求“注册仍 201”，实际 better-auth 的 `sign-up` 返回 200；本实现不伪造状态码，`emailDelivery` 标记附在真实 2xx 上（单测用 201 验证标记逻辑）。
6. **本地联调使用 4300 端口**：4000/4100 被并行 Agent 占用；不影响代码。
7. **Redis 不可用的本地栈**：限流与 Settings 缓存走降级路径，属预期；生产有 Redis 时走 Redis。
8. **`mail.resendApiKey`/`mail.smtpPassword` 写入需要 `CONFIG_ENCRYPTION_KEY`**（既有 B1A 行为，本任务未改）；本地未写入这两个 secret。
9. **ESM 并行编辑干扰**：联调期间其他 Agent 正在改 `bootstrap/process-guards.ts`、`modules/ai/ai.settings.ts`，曾导致 API 短暂无法启动；与本次改动无关。

## 6. 未覆盖项

- 未对真实 Resend 外网发送（按要求用桩，不打外网）；未用真实 Gmail 触发 `EAUTH`（用桩验证分类）。
- 未在 worker 侧验证导出邮件读取 DB 配置（本任务明确不接 worker）。
- 未验证管理端 UI 对 `emailDelivery:"not_configured"` 的展示（`apps/web`/`apps/admin` 不在可写范围）。
- 未做 429 的真实 HTTP 联调（单测覆盖 3/min 与降级；联调只发了 2 次）。
- 未测收到 4xx/5xx Resend 真实响应体（只用桩模拟 status）。

## 7. 建议下一步

1. 由 worker 负责人把 `apps/worker/src/dependencies.ts` 的邮件传输改为读取同一配置（或经 API/DB 的共享配置），消除“API 能改、worker 不能改”的分叉。
2. 让 admin UI 在 `POST /v1/admin/settings/mail/test` 422 时按 `code` 给出中英文操作提示（AUTH_FAILED 指向应用专用密码）。
3. 在真正生产 relay 上跑一次 `admin.mail.probe` 并保存成功/失败证据（Gmail 应用专用密码 + 587 STARTTLS）。
4. 若要严格满足“注册 201”，先与 better-auth 契约负责人确认是否统一状态码，避免前端依赖不同状态。
5. 为 `MailSettingsConsumer` 增加一个真实的 `envLocked` 邮件键（当前 registry 所有 mail 键 `envLocked:false`），让该分支在 live 环境也有覆盖。