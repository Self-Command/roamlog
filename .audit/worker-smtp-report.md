# WORKER_SMTP — Worker 真实 SMTP 传输 + 导出通知邮件失败不判导出失败

状态: DONE
任务 ID: WORKER_SMTP
日期: 2026-11-19 00:38 (+08:00)
角色: data_worker

## 变更文件

依赖（仅此两处，且是本任务唯一批准的依赖变更）：
- `apps/worker/package.json`：`dependencies.nodemailer: 10.6.0`、`devDependencies.@types/nodemailer: 8.0.2`
- `pnpm-lock.yaml`：importers 里新增上述两个 specifier（复用仓库中已存在的 `nodemailer@10.6.0` / `@types/nodemailer@8.0.2` 解析条目，**没有产生任何新版本或版本变化**，`@roamlog/api` 的解析结果不变）

源码（严格限定在邮件相关段）：
- `apps/worker/src/dependencies.ts`：新增 `sendViaSmtp` 及配套（SMTP 模块懒加载/启动期解析检查/错误分级/SMTP 端口与主机校验/回复码解析），删除「worker 无 SMTP 客户端」抛错分支，更新已过时的类型注释
- `apps/worker/src/jobs/export.ts`：仅重写 `notifyExportReady` 的 try/catch 边界

测试：
- `apps/worker/test/email-sender.spec.ts`（扩充，25 tests）
- `apps/worker/test/jobs.spec.ts`（扩充，12 tests）

报告：
- `.audit/worker-smtp-report.md`

未触碰：`apps/api/**`、`apps/web/**`、`apps/admin/**`、`packages/**`、`docker/**`、`.github/**`、compose/deploy、其它 `.audit`、`EMAIL_PROVIDER` 取值集合、环境变量校验规则。未执行任何 git 写操作（无 reset/clean/checkout/stash/commit），未连接生产服务器，未访问 `smtp.gmail.com` 或任何外部 SMTP。

## 实现摘要

### 1) SMTP transport 选择（`sendViaSmtp`）

- 依赖注入点仍是 `createEmailSender`：`resend` → `sendViaResend`、`mailpit` → `sendViaMailpit`、`smtp` → `sendViaSmtp`（原「无 SMTP 客户端」抛错已删除）。
- `EMAIL_PROVIDER` 缺省仍解析为 `smtp`（沿用原 `resolveTransport`，**取值集合未改**：resend / smtp / mailpit）。
- 读取 `SMTP_HOST`（必填，缺失 → `NonRetryableEmailError`）、`SMTP_PORT`（缺省 587；非 1–65535 整数 → `NonRetryableEmailError`）、`SMTP_USER` / `SMTP_PASSWORD`、`EMAIL_FROM`（走既有 `senderAddress()`，即**保留**生产环境 `.local` 与无路由域名拒绝）。
- `secure`：端口 `465` → `true`（隐式 TLS）；`587` 及其它 → `false`，STARTTLS 交给 nodemailer 自动协商（未设 `requireTLS`，与原 API 适配器语义一致）。
- `auth`：**只有 `SMTP_USER` 存在时才传** `{ user, pass: SMTP_PASSWORD ?? "" }`；无用户名的 relay 完全不传 `auth` 键。
- 发送成功返回 `{ providerId: info.messageId }`；`messageId` 缺失时回退到 `message.idempotencyKey`（与 resend/mailpit 分支一致，保证 EmailLog.providerId 非空）。
- 消息头带 `X-Roamlog-Idempotency-Key`（与 mailpit 分支一致）。
- 每次发送创建一个 transport（非连接池）；worker 邮件量低，避免缓存 transport 后 env 变更不生效的问题。

### 2) 可解析性：启动期显式失败 + 缓存

- `assertSmtpClientAvailable()`：`createWorkerDependencies()` 启动时调用；仅当解析出的 transport 是 `smtp` 时检查 `require.resolve("nodemailer")`（只解析路径，不加载模块），失败立刻抛 `NonRetryableEmailError`，`main.ts` 的 `worker.startup_failed` 会记录，进程退出码 1 —— 即**镜像裁剪时启动即失败**，不会等到发信时才炸。
- `loadSmtpModule()`：进程内只解析/导入一次并缓存 Promise（失败的 Promise 同样缓存）。先 `require.resolve` 校验，再用**变量 specifier 的运行时 `import()`** 加载。
  - 用运行时 import 而不是静态 `import nodemailer from "nodemailer"`：静态导入会让裁剪镜像在模块加载期抛裸 `ERR_MODULE_NOT_FOUND`，无法给出清晰错误。
  - 错误信息不带 cause（加载器错误可能回显镜像内路径）。
- 实测：构建产物 `dist/dependencies.js` 内**没有** `from "nodemailer"` 静态导入（`grep -nE "from ['\"]nodemailer" dist/dependencies.js` 为空），保留 `const specifier = "nodemailer"; await import(specifier)`；从 `dist/main.js` 的 require 基准解析成功（见验证 6）。

### 3) 错误分级（`classifySmtpFailure`）

优先级：显式 `error.code` → `error.responseCode` → 兜底。

| 条件 | 结果 |
| --- | --- |
| `EAUTH`、`EENVELOPE`、`EMESSAGE`、`ECONFIG` | `NonRetryableEmailError`（BullMQ `UnrecoverableError`，只失败一次） |
| `ECONNECTION`、`ETIMEDOUT`、`ESOCKET`、`EAI_AGAIN`、`EPIPE`、`ECONNRESET`、`EDNS`、`ETLS` | `EmailDeliveryError`（可重试，走 BullMQ backoff） |
| `responseCode` 4xx | `NonRetryableEmailError` |
| `responseCode` 5xx | `EmailDeliveryError` |
| 其它未知错误 | `EmailDeliveryError`（只有被证明是永久错误才永久失败） |

`EENVELOPE` 优先于 5xx：relay 直接拒绝信封时（如 550/552 邮箱不可用）重试不会改变结果，符合任务「EENVELOPE → NonRetryable」的显式要求。

### 4) 日志脱敏

- 成功：`{ event: "email.sent", transport: "smtp", status: <SMTP 回复码, 来自 info.response 前 3 位>, providerId }`。
- 被拒绝：`{ event: "email.rejected", transport: "smtp", status }`。
- 日志与错误消息**只出现** SMTP code（如 `EAUTH`）或回复码（如 `535`）；`error.message`、`error.response`、收件人地址、密码、SMTP 主机名一律不写入。nodemailer 的 `response` 会回显收件人地址，而 `email.ts` 会把 `error.message` 持久化到 EmailLog，因此错误消息里只保留 code/status。
- 测试用假密码 `hunter2-smtp-secret` + 假邮箱 `explorer@roamlog.test` + 假 relay 回复体断言三者均不出现在日志 JSON 与异常消息中。

### 5) 导出通知邮件与导出结果的边界（关键改动）

`notifyExportReady` 原先是**整段** try/catch（邮件 + `user.findUnique` + `auditLog.create` 全被吞）。现在：

```
user.findUnique            → 不吞（数据库错误照常冒泡）
if (user.email):
    try { email.send }     → 只吞这一段
    catch → logger.warn({ jobId, exportId, errorCode }, "export ready email failed")
auditLog.create            → 不吞（数据库错误照常冒泡）
```

- 邮件失败后**继续**写 `export.completed` 审计，`handleExportJob` 仍返回 `{ status: "ready" }`，`Export.status` 保持 `ready`（zip 已经写入对象存储，UI 可下载）。
- `errorCode` 由 `emailFailureCode()` 生成：优先 `error.code`（如 `EAUTH`），否则 `error.name`（如 `NonRetryableEmailError`），都用 `/^[A-Za-z][A-Za-z0-9_.-]{0,47}$/` 白名单过滤，绝不写入原始 message（原实现把 `error.message` 写进日志，可能含收件人地址）。
- 存储错误、`export` 状态更新、审计写入均未被吞：仍然抛错 → `catch` 标记 `failed` 并 rethrow（有测试覆盖）。

## 验证命令与结果

1. `pnpm --filter @roamlog/worker typecheck`
   ```
   $ tsc --noEmit
   [exit code: 0]      → 0 错误
   ```

2. `pnpm --filter @roamlog/worker test`
   ```
   ✓ test/email-sender.spec.ts (25 tests) 33ms
   ✓ test/jobs.spec.ts (12 tests) 20ms
   ↓ test/queue.spec.ts (4 tests | 4 skipped)
   ↓ test/staging-email.spec.ts (1 test | 1 skipped)
   ↓ test/staging-export.spec.ts (2 tests | 2 skipped)
   ↓ test/staging-media.spec.ts (1 test | 1 skipped)

   Test Files  2 passed | 4 skipped (6)
        Tests  37 passed | 8 skipped (45)
   [exit code: 0]
   ```
   跳过项均为 `describe.skipIf(!stagingEnabled)` 的 staging 集成测试（需要 Redis/MinIO/Mailpit staging 环境），非本次新增失败。

3. `pnpm --filter @roamlog/worker lint`
   ```
   ✖ 19 problems (0 errors, 19 warnings)
   [exit code: 0]
   ```
   19 条 warning 全部是既有的 `@typescript-eslint/no-explicit-any`（`src/jobs/export.ts` 的 `record: any` 等历史代码、`src/jobs/types.ts:9`、`test/jobs.spec.ts:25`）。`git diff -U0 | grep '^+' | grep -w any` 为空 —— **本次没有新增任何 `any`**，warning 数量与改动前一致。

4. `pnpm --filter @roamlog/db typecheck`
   ```
   $ tsc --noEmit
   [exit code: 0]
   ```

5. `pnpm --filter @roamlog/worker build`（额外，为「重建镜像」做的预检）
   ```
   $ tsc -p tsconfig.build.json
   [exit code: 0]
   ```
   `dist/dependencies.js` 无 nodemailer 静态导入，保留运行时 `import(specifier)`。

6. 构建产物运行时可解析性（模拟裁剪检查）
   ```
   $ node -e "...createRequire(apps/worker/dist/main.js).resolve('nodemailer')"
   resolved: C:\...\node_modules\.pnpm\nodemailer@10.6.0\node_modules\nodemailer\dist\cjs\nodemailer.js
   createTransport: function
   ```

7. **真实 SMTP 投递（本机可用本地 SMTP，已实测，非 mock）**
   本机 `127.0.0.1:1025` 有一个真实 SMTP 服务（banner `220 local-verify-smtp ready`，支持 8BITMIME/SMTPUTF8）。用构建产物 `dist/dependencies.js` 的 `createEmailSender` 直连它（`EMAIL_PROVIDER=smtp`、`SMTP_HOST=127.0.0.1`、`SMTP_PORT=1025`、无 `SMTP_USER`、`EMAIL_FROM=Roamlog <hello@roamlog.local>`）：
   ```
   delivered: { "providerId": "<085700de-75bd-b234-d26b-be05fdc5dafe@roamlog.local>" }
   log: { event: "email.sent", transport: "smtp", status: 250, providerId: "<0857...@roamlog.local>" }
   ```
   → 真实 `250` 收件，`secure:false`（1025 非 465）、无 auth（未配置 SMTP_USER），providerId 来自 nodemailer `info.messageId`。

   同脚本的失败路径（真实 socket 错误，非构造）：
   ```
   连接到关闭端口 1025→1: "SMTP relay rejected the message (ESOCKET)" / EmailDeliveryError / retryable=true
   缺 SMTP_HOST:             NonRetryableEmailError "SMTP_HOST is required ..."（未创建 transport）
   ```
   → 真实 nodemailer `ESOCKET` 被判定为可重试；真实未捕获的错误消息未包含收件人或主机明文。

   说明：**未做**带 `SMTP_USER`/`SMTP_PASSWORD` 的真实认证投递，也未做真实 TLS/STARTTLS 握手（本机 SMTP 不提供凭据与 TLS 配置）；`auth`/`secure` 参数正确性由单元测试（mock transport options 断言）覆盖。

## 新增/扩充的测试

`apps/worker/test/email-sender.spec.ts`（新增 12 个用例，保留原 resend/mailpit 用例）：
- 587 → `secure:false` + `auth:{user,pass}` + 请求头 + 返回 `providerId`（messageId）
- 465 → `secure:true`
- 无 `SMTP_USER` → options **没有** `auth` 键
- `messageId` 缺失 → 回退 idempotencyKey
- `EAUTH` → `NonRetryableEmailError` + `UnrecoverableError`，`status=535`
- `EENVELOPE`/550 → `NonRetryableEmailError`
- `ECONNECTION`/`ETIMEDOUT`/`ESOCKET`/`EAI_AGAIN` → `EmailDeliveryError`（非 Unrecoverable）
- 无 code 的 554 → 可重试；451 → 不可重试
- 生产 + `mailpit` → 仍被拒绝（**原有用例保留，未改动**）
- 生产 + 缺 `SMTP_HOST` → 不可重试且未创建 transport（替换掉原「worker 无 SMTP 客户端」用例，该行为已被移除）
- 失败/成功两条路径：日志与异常消息均不含假密码、假邮箱、relay 回复体、SMTP 主机名
- 启动期 gate：smtp 且 nodemailer 可解析 → 通过；resend → 跳过检查；未设置 EMAIL_PROVIDER（缺省 smtp）→ 检查

`apps/worker/test/jobs.spec.ts`（新增 4 个用例）：
- **导出任务邮件失败 → `{status:"ready"}`**，`storage.putObject` 已调用，`Export.status` 最后一次更新仍是 `ready`（不是 failed），审计 `export.completed` 仍写入（targetId/workspaceId 断言），`logger.warn` 恰好调用 1 次且 `{exportId, errorCode:"EAUTH"}`，日志不含邮箱明文与错误原文
- 无 `code` 的错误 → `errorCode:"Error"`（错误类名脱敏路径）
- 存储失败 → 仍然 reject 并把 Export 标记 `failed`（证明只吞邮件这一段）
- 审计写入失败 → 仍然 reject 并把 Export 标记 `failed`（证明数据库错误未被吞）

## CodeGraph 证据

1. `codegraph status`（项目 `C:\Users\BY9700\Desktop\UI\roamlog`）：`Files: 1,485 / Nodes: 22,767 / Edges: 50,285`，`[OK] Index is up to date`（改动后 watcher 已增量同步）。
2. `codegraph_explore`（MCP，`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）
   - 查询 `dependencies.ts sendViaSmtp NonRetryableEmailError createEmailSender email provider smtp mailpit guard`
     → 关键结果：**`Not in the index: sendViaSmtp`**（证明改动前 worker 没有 SMTP 发送实现）；命中 `createEmailSender`(apps/worker/src/dependencies.ts:445)、`sendViaMailpit`(296)、`sendViaResend`(362)、`NonRetryableEmailError`(230)、`EmailDeliveryError`(213)、`resolveTransport`(260)、`senderAddress`(275)、`isRetryableStatus`(243)、`isProductionDeployment`(252)。
     → blast radius：`createEmailSender` 3 callers（`createWorkerDependencies`、测试 `email-sender.spec.ts` / `staging-email.spec.ts`）；`sendViaMailpit` 1 caller。
   - 查询 `export.ts processExportJob deps.email.send export.completed audit`
     → 关键结果：**`Not in the index: processExportJob`**；命中 `handleExportJob`(export.ts:17)、`notifyExportReady`(export.ts:308，blast radius：1 caller `handleExportJob`，tests `jobs.spec.ts` / `staging-export.spec.ts`)、`createExportProcessor`、`buildExportBundle`、`tripBundle`。
   - 查询 `notifyExportReady maskEmail` + `dependencies.ts:1-25 / 194-212`
     → 关键结果：`maskEmail` 只存在于 `apps/admin/lib/admin-data-source.ts:878`（worker 侧没有可复用脱敏函数），因此本实现沿用 worker 既有做法「从不把地址写入日志/错误」，并在 export.ts 新增 `emailFailureCode()` 白名单；同时确认 `dependencies.ts:22` 已有 `createRequire(import.meta.url)`、`WorkerLoggerLike` 定义在 `src/jobs/types.ts:1`。
3. 调用链（CodeGraph relationships，改动前）：`createWorkerDependencies → createEmailSender → {sendViaMailpit, sendViaResend, NonRetryableEmailError}`；`runExport → handleExportJob → notifyExportReady → deps.email.send`（**这是本次要切断的失败传播路径**）。

## 已知风险

1. **审计写入现在是致命错误**（这是任务「不要吞掉数据库写入」的直接结果，但与改动前行为不同）：若 `auditLog.create` 在 zip 已写入后失败，`handleExportJob` 的 catch 会把 Export 置为 `failed`（对象存储里仍有文件）。重试会重新生成导出，用户侧可能看到「已生成却失败」。若希望审计失败也不影响导出，可改为「审计失败 → warn + 让导出保持 ready」，但这与本次指令相反，故未擅自改动。
2. **4xx → 永久失败**是按任务字面要求实现的；RFC 5321 里 SMTP 4xx 本意是临时失败（如 450/451）。当前实现遇到 relay 的 4xx 会直接 `UnrecoverableError`，不重试。
3. `EENVELOPE` 优先于 5xx：550/552（邮箱不可用/超配额）不会重试。若后续希望「5xx 一律重试」，只需把 `PERMANENT_SMTP_CODES` 判定放到 `responseCode` 之后。
4. **启动期失败是行为变化**：当 `EMAIL_PROVIDER=smtp`（含未设置，缺省即 smtp）且镜像内 nodemailer 不可解析时，worker **无法启动**（退出码 1，`worker.startup_failed` 日志）。这是需求要求的「启动期显式失败」，但运维上会表现为容器 CrashLoop 而不是「启动成功但邮件任务失败」。
5. `@types/nodemailer` 已加入 devDependencies，但源码并未直接引用它：worker 侧沿用 API 适配器的做法，用本地最小 `SmtpModule`/`SmtpTransport` 接口声明表面（配合变量 specifier 的运行时 import，静态类型无法自动关联）。它是 dev 依赖、不进运行时镜像；如认为属于无用依赖，可单独移除（不影响任何代码）。
6. 每次发信新建 transport（非连接池）；SMTP 高频场景会有额外握手开销。当前 worker 邮件量低，可接受。
7. 未验证 `SMTP_USER`+`SMTP_PASSWORD` 的真实认证投递，也未验证真实 TLS。参数组装有单测覆盖，但真实 provider 的凭据/TLS 兼容性属于未验证范围。

## 未覆盖项

- 真实的认证 SMTP 与 TLS/STARTTLS 握手（本机 SMTP 为无认证明文服务，且无任何外部凭据授权）。
- `docker/**` 与 compose 未审阅（禁止改动）：镜像重建后是否真的把 `apps/worker` 的生产依赖（含新 nodemailer 符号链接）带进镜像，需重建后实测；若裁剪仍发生，启动期会以 `nodemailer is not resolvable from the worker runtime; rebuild the worker image ...` 明确失败。
- staging 集成测试（`staging-email/staging-export/staging-media/staging-queue`）因无 staging 环境被 skip；其中 `staging-email.spec.ts` 目前仍只覆盖 `mailpit` provider，未加 SMTP 用例。
- `apps/api` 的邮件链路未改、未回归（不在可写范围）。加依赖未改变 api 的 nodemailer 解析版本（lockfile 未新增版本条目）。
- 未做 `EMAIL_PROVIDER` 取值集合与环境变量校验的改动（明确禁止）。

## 建议的下一步

1. **重建 worker 镜像后**在镜像内跑一次：
   `node -e "const{createRequire}=require('node:module');console.log(createRequire('/app/apps/worker/dist/main.js').resolve('nodemailer'))"`，
   并用 `EMAIL_PROVIDER=smtp SMTP_HOST=<测试 relay> SMTP_PORT=25/587` 启动 worker，确认不再出现「no SMTP client」类错误。
2. 在 `apps/worker/test/staging-email.spec.ts` 增加一组 `EMAIL_PROVIDER=smtp` + Mailpit SMTP(1025) 的真实投递用例（`describe.skipIf(!stagingEnabled)` 已有开关，无需额外端口约定）。
3. 对 `event: "email.rejected", transport: "smtp"` 加告警；`EAUTH` 命中通常意味着凭据轮换未同步。
4. 若产品侧接受「审计失败不影响导出」，再评估把 `auditLog.create` 也降级为 warn（需产品/审计口径确认，当前按指令保持致命）。
5. 评估是否引入 transport 复用（长期高频邮件时）或 `pool: true`。