# ADMIN_OPS_TRUTH — Admin 运营真值改造报告

状态: DONE（API + Admin 全部验证通过；契约需根 Agent 串行重新生成）
任务 ID: ADMIN_OPS_TRUTH
日期: 2026-11-18
范围: `apps/admin/components/{content,flags,emails,queues,system}`、`apps/admin/lib/admin-data-source.ts`（相关段落）、`apps/api/src/modules/admin/{admin-queue,admin-metrics,admin-emails,admin-operations.controller,admin-system}.ts`、`apps/api/src/modules/feature-flags/**`、`packages/contracts/src/api/admin.ts`、对应测试

---

## 1. 变更文件

**Admin（页面与数据层）**

| 文件 | 变更 |
|---|---|
| `apps/admin/lib/admin-data-source.ts` | 队列吞吐/`NaN` 未接入语义、`maskEmail`、`AdminQueueMetricsRow`、`AdminSystemSnapshotDetail`（workerSignal/queues）、`useAdminEmailCountsResource`、`createFlag`/`deleteFlag` mutation（同源 raw fetch）、`formatThroughput` |
| `apps/admin/components/queues/queues-view.tsx` | 真实吞吐、动态队列数、可观测状态 badge、Worker 消费端面板、空态 |
| `apps/admin/components/system/system-view.tsx` | 删除硬编码 Redis 面板；Worker 观测信号 + 推导口径；版本/构建时间缺失 → 未接入；队列注册（Redis 发现） |
| `apps/admin/components/content/content-view.tsx` | 举报 badge/列/详情 → 未接入；`flagged` 筛选禁用 + 说明；分享链接改配置驱动；未接入最小设计说明 |
| `apps/admin/components/flags/flags-view.tsx` | 新建（key/描述/灰度/白名单 + 校验）、删除（二次确认）、空状态、未保存离开拦截 + 放弃更改 |
| `apps/admin/components/emails/emails-view.tsx` | 重发仅 failed/bounced（disabled + title + aria）；移除测试邮件；6 项真实计数；收件人脱敏；最近错误原因 |
| 5 个 `*.test.tsx` | 与实现同步；新增 26 条断言 |

**API**

| 文件 | 变更 |
|---|---|
| `apps/api/src/modules/admin/admin-queue.service.ts` | 队列名 Redis 发现（替代 `DEFAULT_QUEUES`）；吞吐窗口；`lastCompleted/lastFailed`；`workerHealth` 观测信号；`countBlockedConsumers` 导出 |
| `apps/api/src/modules/admin/admin-metrics.service.ts` | 队列计数新增 delayed/throughput/时间戳；`emails` 按状态 groupBy 聚合 |
| `apps/api/src/modules/admin/admin-system.service.ts` | 版本/构建时间不再伪造；worker 信号透传；队列来自发现 |
| `apps/api/src/modules/admin/admin-emails.service.ts` | `RESENDABLE_EMAIL_STATUSES = [failed, bounced]`，其余 409 `EMAIL_NOT_RESENDABLE` |
| `apps/api/src/modules/admin/admin-operations.controller.ts` | 新增 `POST /v1/admin/flags`、`DELETE /v1/admin/flags/:key` |
| `apps/api/src/modules/feature-flags/feature-flags.service.ts` | `create`（唯一性/校验/审计，P2002 → 409）、`remove`（404/审计） |
| `packages/contracts/src/api/admin.ts` | `AdminQueueMetricsSchema`、`AdminMetricsSchema.emails?`、`AdminSystemWorker` 信号字段、`buildTime` nullable、`FeatureFlagKeySchema`/`CreateFeatureFlagRequestSchema` |
| 4 个 API spec | 按新实现重写替身（真实 Redis key 形状），新增 9 条用例 |

**报告/检查点**：`.audit/admin-ops-truth-report.md`、`.audit/admin-ops-truth-report.checkpoint.md`

---

## 2. 四个必答问题

### Q1 队列吞吐具体从哪个 Redis key / BullMQ API 读？

**BullMQ API 用过吗？没有。** API 进程**没有** `bullmq` 依赖（`apps/api/package.json` 只有 `ioredis`），`Queue.getJobCounts()` / `Queue.getMetrics()` 无法调用；新增依赖会改 lockfile（明令禁止）。因此直接读 BullMQ 自己写入的同一批键：

| 指标 | Redis key（ioredis keyPrefix 自动补 `roamlog:`） | 命令 |
|---|---|---|
| 吞吐 | `${prefix}:${queue}:completed`（ZSET，score = 完成时间毫秒） | `ZCOUNT <key> <now-300000> +inf` ÷ 5 → jobs/min |
| 最近完成 | 同上 | `ZRANGE <key> -1 -1 WITHSCORES` |
| 最近失败 | `${prefix}:${queue}:failed`（ZSET，score = 失败时间毫秒） | `ZRANGE <key> -1 -1 WITHSCORES` |
| 计数 | `:wait` `:active`（LIST）／`:failed` `:completed` `:delayed`（ZSET）／`:meta`（HASH，paused） | `LLEN`／`ZCARD`／`HGETALL` |
| 队列名 | `SCAN MATCH roamlog:* COUNT 500`，按状态后缀白名单解析 | `SCAN` |

窗口 300s，返回 `throughputPerMinute` + `throughputWindowSeconds`；`ZCOUNT`/`ZRANGE` 抛错 → 两者均 `null`，UI 显示「未接入」（不再编 0）。

### Q2 Worker 健康判据：heartbeat 还是推导？UI 是否标注口径？

**没有 heartbeat**：`grep -rn heartbeat apps/worker/src apps/api/src` 零命中，且 `apps/worker/src` 不在可写清单 → 先做观测，再明确标注：

| 顺序 | 判据（真实可观测） | status | signal |
|---|---|---|---|
| 1 | `CLIENT LIST` 中 `flags=b` 且 `cmd ∈ {bzpopmin, blmpop, brpoplpush}` 的客户端数 > 0 | up | `consumer-clients` |
| 2 | 所有队列 `active` 之和 > 0（有任务正在执行，消费者必然存在） | up | `activity-derived` |
| 3 | 非暂停队列 `waiting` > 0 且 `active = 0` 且阻塞消费者 = 0（有任务排队但无人消费） | down | `consumer-clients` |
| 4 | 最近完成/失败时间 ≤ 10 分钟（近期有活动，当前空闲） | degraded | `activity-derived` |
| 5 | `CLIENT LIST` 失败，或以上证据全无 | degraded + **UI 显示「未接入」** | `unavailable` |

**关键修复**：旧实现按 `CLIENT LIST` 的 `name=` 匹配 worker。实测 BullMQ v6 的 `Worker` **不调用 `CLIENT SETNAME`**（只有 `QueueEvents` 会），因此名称匹配永远匹配不到 → 永久误报 DOWN（P1-10 根因）。现改为按**阻塞命令 + blocked flag** 计数，这是 BullMQ fetch loop 的必然结果（`redis-queue-backend.js:1902 waitForJob → bzpopmin(queue.keys.marker)`）。

**UI 标注**：系统页 Worker 卡与队列页 `QueueWorkerPanel` 均输出「推导口径：Redis CLIENT LIST（阻塞消费者）+ 队列计数」或「最近一次任务完成/失败时间 + 队列 active 数」；不可观测时显示「未接入」+ 所需改动（heartbeat 键）。

### Q3 举报 badge 最终是真实数据还是未接入？

**未接入（需 Report 模型）**。核实结论：`packages/db/prisma/schema.prisma` 无 `Report`/`Moderation` 模型；`apps/api/src/modules/admin` 无 reports 端点；`AdminContentItem.reportCount` 在 API 模式下由 mapper 硬编码 0。因此：

- API 模式：顶部 badge、每行举报列、详情「举报」一律 `未接入`（`title` 说明缺模型/端点）；`flagged` 筛选项 `disabled` + `aria-describedby` 说明；页面顶部给出最小可行设计说明。
- fixture 模式：保留 demo 举报数（页面为 fixture 演示，mode 徽标已标注）。
- **不显示假 0**：`queryByText(/\d+ reports/)` 在 API 模式的测试断言为 not-in-document。

### Q4 功能开关创建是否可用（校验 + 未保存拦截）？

**可用**：`POST /v1/admin/flags`（201）+ `DELETE /v1/admin/flags/:key`，权限 `admin:flags:update`（仅 super_admin），均写审计（`admin.feature_flag.created/deleted`）。

校验（前后端一致）：
- key：`^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`，2–80 字符，**唯一**（预检 + Prisma P2002 → 409 `FEATURE_FLAG_EXISTS`）
- description：trim 后 1–500
- rolloutPercentage：整数 0–100
- rules.workspaceAllowlist：UUIDv7 数组（复用现有 `validateRules`）
- enabled：boolean，默认 false

未保存拦截：`beforeunload` + document 捕获阶段拦截站内 `<a href>` 跳转（`window.confirm`）+ 顶部「有 N 个开关存在未保存的修改」banner + 「放弃更改」。单测覆盖「拦截 anchor 点击使 `defaultPrevented === true`」。

---

## 3. 逐控件对照表

| 页面/控件 | 原状态 | 现在 | 数据来源 |
|---|---|---|---|
| 队列 › 顶部总吞吐 | mapper 固定 `0` → 全部 `0.0 jobs/min` | 5 分钟窗口实测；拿不到 → `未接入` | `roamlog:<queue>:completed` ZSET `ZCOUNT`/`ZRANGE` |
| 队列 › 卡片吞吐 | 固定 0.0 | 每队列实测 + 「5 min window」 | 同上 |
| 队列 › 队列数量文案 | 硬编码「跨四个队列」（页面实为 5） | 「跨 N 个队列（Redis 发现）」；0 → 「Redis 中未发现已注册队列」 | Redis `SCAN` |
| 队列 › 队列清单/名称 | API 硬编码 `DEFAULT_QUEUES` 5 项 | Redis 发现排序；无键 → 空态「未发现队列」 | Redis `SCAN` + 状态后缀白名单 |
| 队列 › 健康 badge | 计数推导 → 全部 `Healthy` | `Paused`/`Needs review`/`Processing`/`Backlog`/`Idle`（只声明可观测状态） | `:meta.paused` + 计数 |
| 队列 › Worker 消费端 | 不存在（页面健康不含 Worker） | 新增面板：阻塞消费者数、最近任务、状态、推导口径；不可证明 → `未接入` | `CLIENT LIST` blocked + `completed/failed` 时间戳 + `active` |
| 系统 › 「队列与 Redis」面板 | 硬编码 `Up · 2 ms`、`key prefix roamlog`、`4 queues` | **已移除**；替换为「队列注册」真实发现列表（name/waiting/active/paused） | `/v1/admin/system`.queues（Redis `SCAN`） |
| 系统 › Worker 状态 | 假 DOWN（名称匹配永不命中）+ 0 consumers | 观测信号；无法证明 → `未接入`（不再伪造 DOWN） | 见 Q2 |
| 系统 › API/Worker 版本 | `0.0.0`（`npm_package_version` 未注入） | `ROAMLOG_API_VERSION`/`ROAMLOG_WORKER_VERSION`；缺失 → `未接入`（`unconfigured` 哨兵） | 环境变量 |
| 系统 › 最近构建 | 用容器启动时间冒充 | `ROAMLOG_BUILD_TIME`；缺失 → `未接入`（contract 改 nullable） | 环境变量 |
| 系统 › 依赖健康 / 迁移 | 真实 | 保持真实（未改语义） | readiness probes、`_prisma_migrations` |
| 内容 › 待审核举报 badge | 固定 `0 reports` | API 模式 `未接入`（badge + title）；fixture 模式 demo 数 | 无源（需 Report 模型） |
| 内容 › 列表举报列 / 详情举报 | mapper 每行写死 0 | API 模式 `未接入` | 无源 |
| 内容 › `flagged` 筛选 | 永远筛不出数据 | API 模式 `disabled` + 「未接入前不可筛选」+ `aria-describedby` | 无源 |
| 内容 › 公开分享链接 | 硬编码 `http://localhost:3000/share/...` | `NEXT_PUBLIC_WEB_BASE_URL` 存在才给链接；否则显示 token + 未接入说明 | 环境变量 |
| 内容 › 删除/恢复/批量 | 已真实 mutation（未提交验证） | 保持真实 mutation + 错误提示（未改语义） | `DELETE/POST /v1/admin/content/:type/:id` |
| 开关 › 列表/空状态 | 0 条时只有标题 | 空状态 + 新建 CTA | `GET /v1/admin/flags` |
| 开关 › 新建 | 无入口、无端点 | 对话框（key/描述/启用/灰度/白名单）+ 校验 + `POST` + 审计 | 新端点 |
| 开关 › 删除 | 无 | 二次确认（输入 key）+ `DELETE` + 审计 | 新端点 |
| 开关 › 未保存离开 | 无 | `beforeunload` + 站内跳转拦截 + banner + 放弃更改 | 客户端 |
| 邮件 › 重发 | 所有行（含 sent/delivered）可点 | 仅 `failed`/`bounced` 可点；其余 `disabled` + `title`（「仅 failed / bounced 可重发，当前为 X」）+ `aria-label`；API 端 409 兜底 | `emailLog.status` |
| 邮件 › 测试邮件 | fixture-only 假入口（API 模式禁用+文案） | **按钮与对话框已移除**；页面常驻说明所需端点 | 无端点 |
| 邮件 › 统计卡 | 4 张（delivered/bounced/complained/failed），漏掉占 100% 的 `sent`，且仅当页 100 条 | 6 张 `sent/queued/delivered/bounced/complained/failed`；API 模式取全库聚合 | PostgreSQL `emailLog.groupBy(status)` via `/v1/admin/metrics.emails` |
| 邮件 › 收件人 | 明文邮箱（表格、aria、审计 metadata） | 一律 `j***@example.invalid` | 客户端 `maskEmail` |
| 邮件 › 最近错误 | 无汇总 | 「最近错误原因」块（错误 + 脱敏收件人 + 时间） | 当页日志（标注为本页最近一条） |

---

## 4. 「未接入」清单与所需后端能力

| 未接入项 | 现在显示 | 所需后端能力 |
|---|---|---|
| 举报/审核（badge、举报列、详情、flagged） | `未接入` + 页面说明卡 | **Report 模型**：`targetType(enum trip/entry/comment)`、`targetId`、`workspaceId`、`reporterId`、`reason(enum+text)`、`status(pending/upheld/rejected)`、`resolvedById`、`resolvedAt`、`createdAt`；`@@unique([targetType,targetId,reporterId])` 去重；`GET /v1/admin/reports?status=&targetType=&cursor=`、`POST /v1/admin/reports/:id/resolve`；权限 `admin:reports:read` / `admin:reports:resolve`；裁决写 `AuditLog`；`flagged` 由 pending 举报投影到内容列表；审核通知队列（`moderation`）。**需要 Prisma 迁移** → 我未改 `schema.prisma`（按任务要求停下由根 Agent 决定）。 |
| Worker 存活（无 heartbeat 时） | `未接入` + 「需要 Worker 心跳」 | Worker 启动写 `roamlog:worker:<id>`（`version`/`startedAt`/`lastLoopAt`/`queues`/`concurrency`），10s 刷新、30s TTL；API 读 HGETALL 判定。备选：允许 `apps/api` 依赖 `bullmq` 用 `Queue.getWorkers()`（会改 lockfile，需根 Agent 批准）。 |
| 测试邮件 | 入口移除 + 说明 | `POST /v1/admin/emails/test`（固定模板、仅白名单域名、频率限制 1/min/actor、审计 `admin.email.test_sent`、返回 `EmailLog`）。 |
| 分享链接可点击 | token + 未接入说明 | 注入 `NEXT_PUBLIC_WEB_BASE_URL`（devops 拥有 `.env.example`/compose）。 |
| 版本 / 构建时间 | `未接入` + 所需变量名 | `ROAMLOG_API_VERSION`、`ROAMLOG_WORKER_VERSION`、`ROAMLOG_BUILD_TIME`（构建期写入镜像）。 |
| 专用开关权限 | 复用 `admin:flags:update` | `permissions.ts` 增加 `admin:flags:create` / `admin:flags:delete`（该文件不在本次可写清单，已在报告中声明）。 |

---

## 5. 验证命令与结果

```text
$ pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit                       # exit 0

$ pnpm --filter @roamlog/admin exec vitest run components/content components/flags components/emails components/queues components/system
 Test Files  5 passed (5)
      Tests  32 passed (32)

$ pnpm --filter @roamlog/api exec vitest run src/modules/admin src/modules/feature-flags
 Test Files  11 passed (11)
      Tests  91 passed (91)

$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit                       # exit 0
```

补充（全量回归，非交付要求）：
```text
$ pnpm --filter @roamlog/admin exec vitest run
 Test Files  16 passed (16)
      Tests  82 passed (82)
```

未执行（按要求）：`build`、`contracts:generate`、`api-client:generate`、`pnpm install`、连接生产/真实 Redis-PG 端到端。API typecheck 未出现 `API_TRIP_MEDIA` 在途文件错误（本次运行 0 错误）。

---

## 6. CodeGraph 证据

```text
$ codegraph status
[OK] Index is up to date            # Files: 1,440 / Nodes / Edges 同步完成
（首次 status 报 Pending Changes: Added 22, Modified 9 → 先 codegraph sync）

$ codegraph explore "content view reports flagged admin-data-source flags view queues view system view emails view admin-queue.service admin-metrics.service"
Found 174 symbols across 7 files → blast radius: AdminMetricsQueuesItem（generated client）、
FlagsViewProps/FlagsView（app/admin/flags/page.tsx + flags-view.test.tsx）、mapAdminQueues、
AdminSystemQueuesItem、AdminSystem（由 /v1/admin/system 消费）

$ codegraph explore "AdminQueueService workerHealth throughput admin-data-source mapAdminQueues reportCount"
Found 229 symbols across 5 files → workerHealth 调用方：admin-system.service.ts（+ 单测）、
mapAdminQueues ← useAdminQueuesResource、ReportCountCellProps ← content-view.tsx（有单测）
```

CodeGraph 结论：`workerHealth` 唯一生产调用方是 `admin-system.service.ts`（队列页通过 `useAdminSystemResource` 只读复用）；`mapAdminQueues` 只有 `useAdminQueuesResource` 一个调用方，故吞吐语义变更的影响面仅限队列页/仪表盘队列卡，未触及 users/workspaces/audit 模块。

---

## 7. 契约变更（需根 Agent 串行重新生成）

| 契约 | 变更 | 影响 |
|---|---|---|
| `AdminQueueMetricsSchema`（新，作为 `AdminMetricsSchema.queues` 的项） | 新增 `delayed?/throughputPerMinute?/throughputWindowSeconds?/lastCompletedAt?/lastFailedAt?`（全部 optional，避免历史快照不合法） | OpenAPI + api-client |
| `AdminMetricsSchema.emails?` | 新增按状态的邮件计数（optional） | OpenAPI + api-client |
| `AdminSystemWorkerSchema` | 新增 `signal`、`blockedConsumers`、`lastJobAt`、`lastJobStatus`、`lastJobQueue` | OpenAPI + api-client |
| `AdminSystemSchema.buildTime` | `IsoTimestamp` → nullable | OpenAPI + api-client |
| `FeatureFlagKeySchema` / `CreateFeatureFlagRequestSchema` | 新增 | OpenAPI（POST /admin/flags body） |
| 端点 `POST /v1/admin/flags`、`DELETE /v1/admin/flags/:key` | 新增 | OpenAPI + api-client |

**在重新生成之前**，Admin 侧用同源 raw fetch + 本地类型（`AdminQueueMetricsRow`、`AdminSystemSnapshotDetail`）兼容旧客户端；重新生成后应删除这些本地类型与类型断言。**需根 Agent 执行** `contracts:generate` / `api-client:generate`（我未执行，按禁令）。

---

## 8. 已知风险

1. **BullMQ 版本耦合**：`CLIENT LIST` 判据依赖 v6 的 `BZPOPMIN` blocking primitive（代码注释已标注，`blmpop`/`brpoplpush` 兜底）。升级 BullMQ 需同步 `BULLMQ_BLOCKING_COMMANDS`。
2. **SCAN 成本**：`listQueues()` 每次 mutation/读取都做一次全键扫描（500/页，上限 200 页）。当前键空间小可接受；上千键时应加 5–10s 缓存。
3. **fail-closed 语义**：`assertQueue` 依赖 Redis 发现，Redis 不可用时队列 mutation 返回 404 `JOB_QUEUE_NOT_FOUND` 而非 503。语义上日后应改为 503。
4. **吞吐是推算值**：5 分钟窗口的完成时间戳，不等于 BullMQ `getMetrics()`（worker 未开启 metrics collection）。已在 UI 标注「5 min window」。
5. **类型断言**：`mapAdminSystem` 产出的扩展字段在 `system-view`/`queues-view` 通过 `AdminSystemSnapshotDetail` 断言读取，重新生成客户端后可消除。
6. **fixture 模式仍显示 demo 数据**（举报数、队列列表），属演示页性质且 mode 徽标已标注；API 模式一律真实或「未接入」。

## 9. 未覆盖项

- 队列/邮件/内容列表的**服务端分页与排序**（固定 `limit: 100`）——审计 P1 项，但不在本任务范围。
- **真实端到端**：未连真实 Redis/PG 跑 `/v1/admin/*`（仅单测替身 + tsc）；未跑 build。
- 审计页 500（P0-01）与 notifications/shell 相关项不在本任务。
- `apps/worker/src` 心跳实现（不可写）——已给出键格式与所需改动。
- `apps/admin/lib/ops-fixtures.ts` 不可写，因此「未接入」语义通过 `mode` + 本地扩展类型表达，而非新增 fixture 字段。

## 10. 建议的下一步

1. 根 Agent：串行 `contracts:generate` + `api-client:generate`，然后移除 Admin 侧本地类型/断言（一个 PR 内可验证）。
2. 产品决策：是否落 **Report 模型 + 迁移**（字段/裁决流程/通知队列已在本报告给出最小设计）。
3. Worker 心跳（或批准 API 依赖 bullmq 用 `getWorkers()`）。
4. devops 注入 `ROAMLOG_API_VERSION` / `ROAMLOG_WORKER_VERSION` / `ROAMLOG_BUILD_TIME` / `NEXT_PUBLIC_WEB_BASE_URL`。
5. `permissions.ts` 增加 `admin:flags:create|delete`（当前复用 update 权限，仅 super_admin 可用，功能无阻塞）。
6. QA：跑一次 admin e2e（flag 创建→刷新→删除、failed 邮件重发、队列 pause/resume）以验证真实网络路径。