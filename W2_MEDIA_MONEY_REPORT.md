# W2-API-MEDIA-MONEY 交付报告

状态: DONE_WITH_CONCERNS
任务 ID: W2-API-MEDIA-MONEY

## 变更文件

### API

- `apps/api/src/modules/media/**`
  - `media.module.ts`
  - `media.controller.ts`
  - `media.service.ts`
  - `media.repository.ts`
  - `media-records.ts`
  - `media.presenter.ts`
  - `media-rules.ts`
  - `media-tenant.guard.ts`
  - `__tests__/media-rules.spec.ts`
- `apps/api/src/modules/expenses/**`
  - `expenses.module.ts`
  - `expenses.controller.ts`
  - `expenses.service.ts`
  - `expenses.repository.ts`
  - `expense-records.ts`
  - `expense.presenter.ts`
  - `expense-money.ts`
  - `expense-tenant.guard.ts`
  - `__tests__/expense-money.spec.ts`
- `apps/api/src/modules/packing/**`
  - `packing.module.ts`
  - `packing.controller.ts`
  - `packing.service.ts`
  - `packing.repository.ts`
  - `packing-records.ts`
  - `packing.presenter.ts`
  - `packing-order.ts`
  - `packing-tenant.guard.ts`
  - `__tests__/packing-order.spec.ts`
- `apps/api/src/modules/exports/**`
  - `exports.module.ts`
  - `exports.controller.ts`
  - `exports.service.ts`
  - `exports.repository.ts`
  - `export-records.ts`
  - `export.presenter.ts`
  - `export-rules.ts`
  - `job-queue.module.ts`
  - `job-queue.service.ts`
  - `__tests__/export-rules.spec.ts`

### Worker

- `apps/worker/src/jobs/email.ts`
- `apps/worker/src/jobs/export.ts`
- `apps/worker/src/jobs/index.ts`
- `apps/worker/src/jobs/maintenance.ts`
- `apps/worker/src/jobs/media.ts`
- `apps/worker/src/jobs/reminders.ts`
- `apps/worker/src/jobs/blurhash.ts`
- `apps/worker/src/jobs/types.ts`
- `apps/worker/src/jobs/zip.ts`
- `apps/worker/src/dependencies.ts`
- `apps/worker/src/ingress.ts`
- `apps/worker/src/main.ts`
- `apps/worker/test/jobs.spec.ts`

未修改 `app.module.ts`、`apps/api/package.json`、contracts、db、web/admin、原型、设计文档或 lockfile。

## 实现摘要

### Media

- `POST /v1/workspaces/:workspaceId/media/presign`
- `POST /v1/media/:mediaId/complete`
- `GET /v1/workspaces/:workspaceId/media`
- `GET /v1/trips/:tripId/media`
- `PATCH /v1/media/:mediaId`
- `DELETE /v1/media/:mediaId`
- `POST /v1/trips/:tripId/cover`
- MIME 白名单：JPEG/PNG/WebP/AVIF/HEIC/HEIF；最大 25MB；UUIDv7 media id。
- 对象 key 固定为 `{workspaceId}/{yyyy}/{mm}/{mediaId}/{variant}.{ext}`，不使用原始文件名，拒绝 `..`、绝对路径、反斜杠、空路径段和控制字符。
- 私有 bucket，列表与详情通过 `StorageService.createSignedReadUrl` 生成短时 URL；因 `Media` 契约没有 URL 字段，签名 URL 合入 `variants` 对象。
- 完成上传后 `status=processing` 并入队 `media.process`；失败可见于 `Media.error/status`。
- 删除为软删除并解除日志媒体、旅行封面、Workspace logo 引用；24 小时后入队对象清理。
- 封面要求 `status=ready` 且媒体属于同一 Workspace/旅行。

### Expenses / Budget / Settle-up

- `GET/POST /v1/trips/:tripId/expenses`
- `PATCH/DELETE /v1/expenses/:expenseId`
- `GET /v1/trips/:tripId/budget/summary`
- `GET /v1/trips/:tripId/budget/settle-up`
- `equal`：服务端整数均分，余数给付款人；忽略客户端伪造份额前先校验。
- `custom`：份额总和必须严格等于 `amountMinor`，否则 `400`。
- 更新金额/付款人时若无 participants 且原模式为 custom，明确拒绝，避免产生不平分账。
- 参与者和付款人必须是活跃 Workspace 成员；收据媒体必须属于同一 Workspace/旅行。
- 原币种分组汇总；显示币种使用静态汇率并标 `approx: true`；分类汇总、超预算布尔值返回。
- settle-up 按原币种分别计算建议，不写 `Settlement`、不改变余额。

### Packing

- `GET/POST /v1/trips/:tripId/packing`
- `PATCH/DELETE /v1/packing/:itemId`
- `POST /v1/trips/:tripId/packing/reorder`
- `POST /v1/trips/:tripId/packing/bulk`
- reorder 拒绝重复 id、拒绝跨旅行 id，并在事务内压紧为连续序号。
- bulk 支持 create/update/delete；单个 version 冲突回滚整个事务并返回 `409 VERSION_CONFLICT`。
- 完成/重置：`PATCH packed=true` 标记完成；`bulk update packed=false` 可批量重置。未新增契约外端点。

### Exports

- `POST /v1/exports`（202，支持可选 `Idempotency-Key`）
- `GET /v1/exports`
- `GET /v1/exports/:exportId`（ready 时返回短时签名下载 URL）
- `DELETE /v1/exports/:exportId`
- `trip` / `workspace` / `account`，`zip` / `json`，include flags 全量透传。
- 私有 storage key：`exports/{workspaceId}/{exportId}/export.{zip|json}`。
- Worker 完成后写入 `expiresAt = completedAt + 7 天`；API 读取时惰性标记过期，maintenance 清理对象与状态。
- 仅 requester 或 Workspace Owner/Admin 可读取/删除；viewer/editor 不能读取他人导出。
- 导出请求、下载、删除写 `AuditLog`；完成由 worker 写 `export.completed`。

### Worker

- `media.process`：download → magic bytes 校验 → sharp 缩略图/medium/large（WebP + JPEG fallback）→ blurhash → variants/宽高落库；重复 job 在 ready 状态直接返回；失败写 `status=failed/error` 并抛错触发 BullMQ 重试。
- `media.cleanup`：仅在媒体已软删除时删除对象；重复执行幂等。
- `email`：以 `EmailLog` 状态作为幂等边界；已 sent/delivered 不重发；失败写 failed 并抛错。
- `export.generate`：组装 trip/workspace/account JSON 或 ZIP，上传私有对象，写 ready/expiresAt，发送 export-ready 邮件与审计；已完成或已过期不重复生成。
- `reminders`：出发前 7/1 天扫描旅行与活跃成员，创建 Notification + EmailLog；同日同旅行同用户已存在通知时跳过。
- `maintenance`：过期导出、24h 软删除媒体对象、30 天软删除内容物理清理、过期 session 清理；支持 `dryRun`。
- Redis ingress：API 写入 `roamlog:jobs:ingress`，worker 读取后用确定性 `jobId` 入 BullMQ，避免 API 进程直接依赖 BullMQ。

## 需 root 注册/依赖

1. `apps/api/src/app.module.ts` 增加并注册：
   - `MediaModule` from `./modules/media/media.module.js`
   - `ExpensesModule` from `./modules/expenses/expenses.module.js`
   - `PackingModule` from `./modules/packing/packing.module.js`
   - `ExportsModule` from `./modules/exports/exports.module.js`
2. Worker 运行依赖当前已在 `apps/worker/package.json` 与 lockfile 中完成接线：
   - `@roamlog/db`
   - `@roamlog/emails`
   - `sharp`
   - 其他环境部署时仍需执行 `pnpm install` 并准备 `DATABASE_URL`、`S3_*`、`RESEND_API_KEY`。
3. Worker 已在通过 Redis ingress 消费 API 任务；无需额外端口。确认 API 与 worker 的 `REDIS_URL` / `REDIS_PREFIX` 一致。
4. 现有 `0001_init` 已包含 Media/Expense/ExpenseParticipant/PackingItem/Export 表，无需新增迁移。
5. 环境变量沿用现有 `.env.example`：`DATABASE_URL`、`REDIS_URL`、`REDIS_PREFIX`、`S3_*`、`RESEND_API_KEY`、`EMAIL_FROM`。

## 验证命令与结果

```text
pnpm --filter @roamlog/api test       → 39 files / 201 tests passed
pnpm --filter @roamlog/api typecheck  → passed
pnpm --filter @roamlog/api build      → passed
pnpm --filter @roamlog/worker lint    → passed（0 errors / 19 warnings）
pnpm --filter @roamlog/worker test    → 1 passed / 1 skipped, 8 tests passed / 4 skipped
pnpm --filter @roamlog/worker typecheck → passed
pnpm --filter @roamlog/worker build   → passed
```

Worker 的 4 个 skipped 测试来自既有 `queue.spec.ts` 的无 Redis 自动跳过机制，已保留。

Lint 修复：

- `dependencies.ts` 中三处 catch-and-rethrow 均改为 `new Error(message, { cause: error })`，不关闭规则。
- `createImageProcessor` 的 `blurhash` 改为明确的控制流赋值，消除 `no-useless-assignment`。
- 剩余 19 条 warning 均为既有宽松 Prisma 适配层的 `no-explicit-any`，按要求保留。

覆盖的关键测试：

- equal 余数给付款人：`splitEqualAmount(100, 3)` → `34/33/33`
- custom 总额不平被拒绝
- 多币种 settle-up 不跨币种合并
- presign 非法 MIME/非法 key traversal
- packing reorder 重复 id 与压紧序号
- export 仅 requester/admin、ready 且未过期才给下载 URL
- 重复 media/export/email job 的幂等行为

## 未覆盖/风险

- API 模块尚未注册到 `app.module.ts`，因此 HTTP 级 E2E、鉴权链和 OpenAPI 运行时尚未验证；需 root 接线后复跑。
- 未对真实 MinIO/S3、Postgres、Redis 做本任务的端到端上传/导出验证；当前为服务/角色/规则级单元测试。
- Worker 依赖已解析（`@roamlog/db`、`@roamlog/emails`、`sharp` 均存在），但本任务未启动真实 worker 进程做 Redis/S3/Postgres 端到端验证。
- `CreateExportRequest` 契约没有 Workspace 字段。`workspace/account` scope 当前支持可选 query `?workspaceId=`，否则取当前用户最早加入的 Workspace；需要产品或契约确认正式方案。
- 契约 `CreateExportRequest` 对 `includeExpenses/includeMedia` 的默认值是 `false`，而设计文档 §11.4 写默认 `true`。本实现遵循 Global Constraints「contracts 是事实源」，使用契约默认值；如产品要默认包含，需先改 contracts。
- `Export` 表只有一个 `workspaceId` 字段，account scope 以该 Workspace 为落库归属，但 worker 的账号导出会汇总用户所有活跃 Workspace；这是现有模型下的折中。
- Media 契约没有签名 URL 字段，URL 暂放在 `variants` JSON 中；若前端需要稳定字段，应走 contracts ADR。
- Blurhash 使用本地最小 4×3 编码器；建议与标准库做截图/解码对比。
- Worker email renderer 依赖 `@roamlog/emails`，模板覆盖不含 `export-ready` 专用模板；当前 export-ready 使用内联纯文本/HTML。
- 尚未执行 `pnpm tooling:minio-smoke`（任务验证清单未要求，且未触碰运行中的 3000/3001）。

## 建议下一步

1. root 在 `app.module.ts` 注册四个模块，并在 worker 补依赖后执行 `pnpm install`。
2. 复跑 API build/test，并新增 media/expenses/packing/exports 的 HTTP E2E（跨租户 IDOR、viewer 403、version 409）。
3. 在本地 MinIO/Redis/Postgres 上跑一次真实上传 → complete → worker ready → 相册签名 URL 流程，以及 trip ZIP/JSON 导出 → 签名下载 → 过期清理流程。
4. 确认 account/workspace export 的 Workspace 选择契约，并决定是否给 Media 增加显式 `urls` 字段。
