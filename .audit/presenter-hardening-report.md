# PRESENTER_HARDENING — 整行 spread → 逐字段显式构造交付报告

状态：DONE
任务 ID：PRESENTER_HARDENING
时间：2026-11-19
范围：`apps/api/src/modules/{packing,expenses,exports}/**`（presenter 与其测试）、`.audit/presenter-hardening-report.md`

> 模块名说明：仓库不存在 `modules/money`。money 域实际落在 `apps/api/src/modules/expenses/**`（`ExpenseSchema` / `ExpenseWithSplitsSchema`），因此按“money = expenses”处理。`trips`、`media`、`storage`、`settings`、`admin`、`share-links`、`entries`、`packages`、`apps/web`、`apps/admin` 均未触碰。

## 1. 变更文件

- `apps/api/src/modules/packing/packing.presenter.ts` — `presentPackingItem` 改显式构造
- `apps/api/src/modules/packing/__tests__/packing-presenter.spec.ts`（新建）— 防复发回归测试
- `apps/api/src/modules/expenses/expense.presenter.ts` — `presentExpense` 改显式构造
- `apps/api/src/modules/expenses/__tests__/expense-presenter.spec.ts`（新建）— 防复发回归测试
- `apps/api/src/modules/exports/export.presenter.ts` — `presentExport` 改显式构造；新增 `PresentExportOverrides`（只在响应层覆盖 `status`/`error`，不回写数据库）
- `apps/api/src/modules/exports/exports.service.ts` — 列表映射改为显式 lambda；过期分支不再 spread 整行
- `apps/api/src/modules/exports/__tests__/export-presenter.spec.ts`（新建）— 防复发回归测试 + 过期覆盖测试
- `.audit/presenter-hardening-report.md`（本报告）

`git status` 边界确认：没有改动 `modules/trips/**`、`modules/media/**`、`modules/storage/**`、`modules/settings/**`、`modules/admin/**`、`modules/share-links/**`、`modules/entries/**`、`packages/**`、`apps/web/**`、`apps/admin/**`。

## 2. 实现摘要

### 2.1 逐处改为显式构造

- `presentPackingItem`
  - 字段来源：`packages/contracts/src/entities/packing.ts` 的 `PackingItemSchema`（`.strict()`）。
  - 显式列出：`id / workspaceId / tripId / category / name / quantity / packed / assigneeId / order / createdById / updatedById / createdAt / updatedAt / deletedAt / version`。
  - 时间字段：`createdAt`/`updatedAt` 走 `iso()`，`deletedAt` 走 `nullableIso()`；`assigneeId` 为 `null` 时原样传 `null`，不省略键。
- `presentExpense`
  - 字段来源：`packages/contracts/src/entities/expense.ts` 的 `ExpenseWithSplitsSchema`（继承 `.strict()` 的 `ExpenseSchema`，额外要求 `participants`）。
  - 显式列出：`id / workspaceId / tripId / date / category / note / amountMinor / currency / paidById / splitMode / receiptMediaId / createdById / version / createdAt / updatedAt / deletedAt / participants`。
  - `date` 走 `presentDate()`，`createdAt`/`updatedAt` 走 `iso()`，`deletedAt` 走 `nullableIso()`；`receiptMediaId` 为 `null` 时传 `null`。
  - `participants` 原本已是显式映射，保留并继续只映射 `workspaceId / expenseId / userId / shareAmountMinor`，不 spread participant 行。
- `presentExport`
  - 字段来源：`packages/contracts/src/entities/export.ts` 的 `ExportSchema`（`.strict()`）；`ExportDetailSchema = ExportSchema.extend({ downloadUrl })`。
  - 显式列出：`id / workspaceId / tripId / requestedById / scope / format / includeComments / includeExpenses / includeMedia / status / storageKey / error / expiresAt / createdAt / completedAt`。
  - `expiresAt`/`completedAt` 走 `nullableIso()`；`tripId`/`storageKey`/`error` 为 `null` 时传 `null`。
  - `presentExportDetail` 仍只 spread `presentExport()` 的**契约输出对象**，不 spread 数据库行。
- `exports.service.ts` 过期分支
  - 原写法：`presentExportDetail({ ...record, status: "expired", error: "Export expired." }, null)`。
  - 现写法：`presentExportDetail(record, null, { status: "expired", error: "Export expired." })`。
  - 这是本模块内最后一处整行 spread；改完后 `rg -n "\.\.\.record" apps/api/src/modules/{packing,expenses,exports}` 为 **0 命中**。

### 2.2 可空字段

所有 `.nullable()` 字段都**始终提供键**：记录为 `null` 时传 `null`，不靠省略键表达空值。显式列出的 `assigneeId`、`receiptMediaId`、`tripId`、`storageKey`、`error` 都是直接 `record.x`；日期型空值统一由 `nullableIso` 返回 `null`。

### 2.3 没有使用运行时剥字段

未引入 `stripObject()` / `omit()` / `pick()` 等运行时过滤。字段列表就是代码里的字面量，因此“新加列忘了暴露”在代码审查 diff 里可见；不会出现“运行时静默剥掉、但没人知道漏了哪列”的情况。

### 2.4 防复发回归测试（每处一条）

- `packing-presenter.spec.ts`：`validRow + someFutureColumn + moderatedAt` → `presentPackingItem` 不抛；`PackingItemSchema.parse` 通过；输出不含 `someFutureColumn`/`moderatedAt`；并断言 `assigneeId`/`deletedAt` 仍为 `null`。
- `expense-presenter.spec.ts`：`validRow + someFutureColumn + moderatedAt` → `presentExpense` 不抛；`ExpenseWithSplitsSchema.parse` 通过；输出与 participant 均不含额外列；并断言 `receiptMediaId`/`deletedAt` 仍为 `null`。
- `export-presenter.spec.ts`：`validRow + someFutureColumn + moderatedAt` → `presentExport` 不抛；`ExportSchema.parse` 通过；输出不含额外列；`presentExportDetail` 同样覆盖；另加一条过期覆盖测试，断言 `status/error` 只在响应里覆盖、原 record 不被改写。

## 3. 完整 presenter 清单

行号为本次交付后的当前行号。`现状` 中的“显式”= 逐字段字面量构造；“spread”= 仍把整行对象展开进 `.strict()` schema 或传给会展开的内层 presenter。

| # | presenter 文件:行 | 原写法 | 现状 | 本次是否修改 | 若未改，谁负责 |
|---|---|---|---|---|---|
| 1 | `apps/api/src/modules/packing/packing.presenter.ts:13` `presentPackingItem` | `...record` | 显式 | 是 | — |
| 2 | `apps/api/src/modules/expenses/expense.presenter.ts:11` `presentExpense` | `...record` | 显式 | 是 | — |
| 3 | `apps/api/src/modules/exports/export.presenter.ts:17` `presentExport` | `...record` | 显式 | 是 | — |
| 4 | `apps/api/src/modules/exports/exports.service.ts:151` 过期导出分支 | `{ ...record, status, error }` | 显式 overrides | 是 | — |
| 5 | `apps/api/src/modules/trips/content-presenters.ts:199` `presentStop` | `...record` | spread | 否 | trips owner（DESTINATIONS_UPGRADE 之后） |
| 6 | `apps/api/src/modules/trips/content-presenters.ts:221` `presentParticipant` | `...record` | spread | 否 | trips owner |
| 7 | `apps/api/src/modules/trips/content-presenters.ts:290` `presentRevision` | `...record` | spread | 否 | trips owner |
| 8 | `apps/api/src/modules/trips/content-presenters.ts:317` `presentItineraryItem` | `...record` | spread | 否 | trips owner |
| 9 | `apps/api/src/modules/trips/content-presenters.ts:337` `presentActivity` | `...record` | spread | 否 | trips owner |
| 10 | `apps/api/src/modules/admin/admin.presenters.ts:36` `presentAdminAuditLog` | `...record` | spread | 否 | admin owner（本任务禁止触碰 admin） |
| 11 | `apps/api/src/modules/admin/admin.presenters.ts:55` `presentEmailLog` | `...record` | spread | 否 | admin owner |
| 12 | `apps/api/src/modules/admin/admin.presenters.ts:72` `presentFeatureFlag` | `...record` | spread | 否 | admin owner |
| 13 | `apps/api/src/modules/entries/entries.service.ts:467` 私有 `presentEntry` | `...record`（透传） | spread（透传） | 否 | entries owner；内层 `content-presenters.presentEntry` 已显式，风险低 |
| 14 | `apps/api/src/modules/entries/entries.service.ts:474` 私有 `presentRevision` | `...record`（透传） | spread（透传） | 否 | entries owner + trips owner；内层 `presentRevision` 仍 spread，风险高 |

已确认无需改动的显式 presenter（B4 已修或本来显式，不在上表重复列）：

- `apps/api/src/modules/trips/content-presenters.ts:131` `presentTrip` — 显式（B4）
- `apps/api/src/modules/trips/content-presenters.ts:251` `presentEntry` — 显式（B4）
- `apps/api/src/modules/admin/admin.presenters.ts:79` `presentMedia` — 显式（B4）
- `apps/api/src/modules/admin/admin.presenters.ts:129` `presentComment` — 显式（B4）
- `apps/api/src/modules/media/media.presenter.ts:55` `presentMedia` — 显式（B4 已确认）
- `apps/api/src/modules/comments/comments.service.ts` 的 `presentComment` — 显式（B4 已确认）

其他非 presenter 边界的 spread（只记录，不属于 `.strict()` 输入，未改）：

- `apps/api/src/modules/media/media.service.ts:698` `{ ...record, motion }` — 内部 `MediaRecord` 组装，不直接进 schema（media owner）
- `apps/api/src/modules/comments/comments.repository.ts:80` `{ ...item, targetType }` — repository 内部（comments owner）
- `apps/api/src/modules/activities/activities.repository.ts:27` `...input` — Prisma create data（activities owner）
- `apps/api/src/modules/trips/trips.service.ts:442-445, 470-472` — 数组/克隆数据展开，不是行 spread 进 schema（trips owner）
- `apps/api/src/modules/exports/export.presenter.ts:44` `...presentExport(record, overrides)` — 展开的是已 parse 的契约输出，不是数据库行

## 4. 验证命令与原始结果

### 4.1 `pnpm --filter @roamlog/api typecheck`

```text
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
src/modules/share-links/__tests__/public-bucket.spec.ts(6,40): error TS2307: Cannot find module '../../../activities/activities.service.js' or its corresponding type declarations.
src/modules/share-links/__tests__/public-bucket.spec.ts(225,20): error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string | URL'.
src/modules/share-links/__tests__/public-bucket.spec.ts(284,20): error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string | URL'.
```

并行污染说明：`apps/api/src/modules/share-links/__tests__/public-bucket.spec.ts` 是 **16:03 新出现的未跟踪文件**（`?? apps/api/src/modules/share-links/__tests__/public-bucket.spec.ts`），同时 `share-links.service.ts` 有并行修改；它不在我的可写范围，也不是本次改动引入。按任务要求过滤我的范围：

```text
$ grep -E "modules/(packing|expenses|exports)" /tmp/typecheck2.log | wc -l
0
$ grep -E "modules/(packing|money|exports)" /tmp/typecheck2.log | wc -l
0
```

（`modules/money` 不存在，实际对应 `modules/expenses`，两个 grep 都是 0。）本次改动相关的类型错误为 **0**；改动前我曾跑到 `TYPECHECK_EXIT=0`，随后并行 Agent 在 share-links 引入了上述未跟踪测试文件。

### 4.2 目标模块测试

```text
$ pnpm --filter @roamlog/api exec vitest run src/modules/packing src/modules/expenses src/modules/exports

 ✓ src/modules/packing/__tests__/packing-presenter.spec.ts (2 tests)
 ✓ src/modules/packing/__tests__/packing-order.spec.ts (3 tests)
 ✓ src/modules/expenses/__tests__/expense-presenter.spec.ts (2 tests)
 ✓ src/modules/expenses/__tests__/expense-money.spec.ts (5 tests)
 ✓ src/modules/exports/__tests__/export-presenter.spec.ts (3 tests)
 ✓ src/modules/exports/__tests__/export-rules.spec.ts (3 tests)
 ✓ src/modules/exports/__tests__/job-queue.service.spec.ts (2 tests)

 Test Files  7 passed (7)
      Tests  20 passed (20)
```

### 4.3 端到端真实读取路径（隔离端口 `:4290` + 隔离 schema）

环境：

- `DATABASE_URL=postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=presenter_hardening`
- `API_PORT=4290`、`API_URL=http://127.0.0.1:4290`
- `NODE_ENV=development`；Redis/Storage 未启动（API 按既有 fail-open 策略启动，读取路径不依赖它们）
- 数据：seed 一个 workspace / owner 成员 / trip / packing item / expense + participant / queued export / expired export；auth 用更好的 better-auth 签名 session cookie（fixture 会话，不是产品后门）
- 验后已执行 `DROP SCHEMA "presenter_hardening" CASCADE`，`:4290` 已关闭

实际路由（与任务里的示例路由不同，按模块真实 controller）：

```text
### GET /v1/trips/01942f30-1200-7000-8000-000000000f05/packing -> HTTP 200
{"items":[{"id":"01942f30-1200-7000-8000-000000000f06",...,"assigneeId":null,...,"deletedAt":null,"version":1}],"nextCursor":null,"hasMore":false}

### GET /v1/trips/01942f30-1200-7000-8000-000000000f05/expenses -> HTTP 200
{"items":[{"id":"01942f30-1200-7000-8000-000000000f07",...,"date":"2026-11-18",...,"receiptMediaId":null,...,"participants":[{"workspaceId":"...","expenseId":"...","userId":"...","shareAmountMinor":1000}]}],"nextCursor":null,"hasMore":false}

### GET /v1/trips/01942f30-1200-7000-8000-000000000f05/budget/summary -> HTTP 200
{"tripId":"...","displayCurrency":"KRW","originalTotals":[{"currency":"KRW","amountMinor":1000}],...,"expenseCount":1,"overBudget":false}

### GET /v1/trips/01942f30-1200-7000-8000-000000000f05/budget/settle-up -> HTTP 200
{"tripId":"...","suggestions":[]}

### GET /v1/exports -> HTTP 200
{"items":[{"id":"...f09",...,"status":"ready",...},{"id":"...f08",...,"status":"queued",...}],"nextCursor":null,"hasMore":false}

### GET /v1/exports/01942f30-1200-7000-8000-000000000f08 -> HTTP 200
{"id":"...f08",...,"status":"queued",...,"downloadUrl":null}

### GET /v1/exports/01942f30-1200-7000-8000-000000000f09 -> HTTP 200
{"id":"...f09",...,"status":"expired","error":"Export expired.",...,"downloadUrl":null}
```

关键结论：**全部 200，无 500**。其中过期导出命中本次重构的 `presentExportDetail(..., overrides)` 分支，证明该分支也正常。

### 4.4 全量 API 测试

```text
$ pnpm --filter @roamlog/api test

 Test Files  1 failed | 118 passed | 7 skipped (126)
      Tests  2 failed | 925 passed | 16 skipped (943)

 FAIL  test/trip-origin.e2e-spec.ts > trip origin normalization > creates a trip with a normalized origin when the optional field is omitted
AssertionError: expected 500 to be 201
 FAIL  test/trip-origin.e2e-spec.ts > trip origin normalization > trims a supplied origin before storing it
AssertionError: expected 500 to be 201
```

这两个失败属于并行 `DESTINATIONS_UPGRADE` 的污染，不是本次改动：

- `apps/api/src/modules/trips/trips.service.ts:241` 新增 `await this.repository.createDestinations(...)`
- `apps/api/src/modules/trips/trips.service.ts:262` 新增 `return (await this.repository.findTrip(membership.workspaceId, record.id, tx)) ?? record`
- `apps/api/test/trip-origin.e2e-spec.ts:57-62` 的 `TripsRepository` mock 只提供了 `transaction / findMedia / createTrip / createParticipant`，没有 `createDestinations` / `findTrip`，因此 create 路径抛错返回 500。
- 上述文件都在 `modules/trips/**` 与 `test/trip-origin.e2e-spec.ts`，按并行约束**我没有修改**，应由 DESTINATIONS_UPGRADE 的 owner 更新该 e2e mock（或给 mock 补上新增仓库方法）。

除该文件外，全量测试 **925 passed**，其中包含本次新增的 7 条 presenter 测试。

## 5. CodeGraph 证据

1. `codegraph status`：

```text
[OK] Index is up to date
Files: 1,766 / Nodes: 27,725 / Edges: 63,501（查询时统计）
```

2. MCP `codegraph_explore`（`projectPath=C:\Users\BY9700\Desktop\UI\roamlog`）：

查询：`packing presenter PackingItemSchema expense presenter ExpenseSchema export presenter ExportSchema presentPackingItem presentExpense presentExport`

关键结果：命中 29 symbols / 12 files；blast radius 明确列出：
- `presentPackingItem` — `apps/api/src/modules/packing/packing.service.ts` 中 7 个调用方
- `presentExpense` — `apps/api/src/modules/expenses/expenses.service.ts` 中 6 个调用方
- `presentExport` — 5 个调用方（presenter + exports.service）
- `presentExportDetail` — 3 个调用方（exports.service）
并直接返回了 `PackingItemSchema` / `ExpenseWithSplitsSchema` / `ExportSchema` 的 `.strict()` 源码与 `ExportDetailSchema = ExportSchema.extend(...)`，确认加列会触发 strict 校验失败。

3. CLI `codegraph explore "presentPackingItem presentExpense presentExport presentExportDetail"`：

```text
Found 25 symbols across 8 files.
- presentExpense — 6 callers in apps/api/src/modules/expenses/expenses.service.ts; tests: expense-presenter.spec.ts
- presentPackingItem — 7 callers in apps/api/src/modules/packing/packing.service.ts; tests: packing-presenter.spec.ts
- presentExportDetail — 3 callers in apps/api/src/modules/exports/exports.service.ts; tests: export-presenter.spec.ts
- presentExport — 5 callers in export.presenter.ts / exports.service.ts; tests: export-presenter.spec.ts
```

据此逐一核对了调用点：`exports.service.ts` 的 `visible.map(presentExport)` 已在签名新增 `overrides` 后改成显式 lambda，其他调用点均只传 `record`，不会把数组索引误当 overrides。

## 6. 已知风险

1. **`ExportRecord` / `PackingItemRecord` / `ExpenseRecord` 是手写接口，repository 仍用 `as` 断言 Prisma 行**。显式 presenter 已切断“额外列进 schema”的 500，但新增列若需要对外暴露，仍必须同时改接口、presenter 和 contracts；这三处不会自动同步。建议后续用 Prisma 生成类型或 repository 显式 `select` 收口。
2. **本模块之外的 spread 仍在**：`trips` 5 处、`admin` 3 处、`entries` 2 处透传（其中 `entries.presentRevision` 的内层 `trips.presentRevision` 也是 spread，风险最高）。它们仍是下一次“加列 → 500”的候选；本次严格按边界未动。
3. **`presentExport` 增加 `overrides` 参数**后，`Array.map(presentExport)` 这类用法会静默把 index 当 overrides（TypeScript 已在本次改动的 `exports.service.ts` 捕获并修复）。其他未来调用点需要避免直接把函数引用传给 `map`。
4. **E2E 使用 fixture 会话**（直接 seed session + 签名 cookie），验证的是读取路径与 presenter 边界，不覆盖真实登录/验证邮件；登录链路由既有 e2e 覆盖。
5. 全量测试中的 `trip-origin.e2e-spec.ts` 2 条失败是并行污染，合并前必须由 trips owner 修复，否则整体 `pnpm --filter @roamlog/api test` 不会全绿。

## 7. 未覆盖项

- 未覆盖 `modules/trips/**` 的 5 个 presenter（Stop / Participant / Revision / ItineraryItem / Activity）——按约束只列不改。
- 未覆盖 `admin.presenters.ts` 的 3 个 spread（AuditLog / EmailLog / FeatureFlag）与 `entries.service.ts` 的 2 个透传 spread——不在可写范围。
- 未覆盖 `PackingItem` / `Expense` / `Export` 的新增列“真正需要对外暴露”的契约变更；本次只保证未知列被忽略，不改变对外字段集。
- 未覆盖真实 S3/MinIO 下载路径（隔离环境未启动 storage；过期分支已证明不需要 storage，ready + 有效期内分支仍由 `staging-export-download.e2e-spec.ts` 在 staging 环境覆盖）。
- 未覆盖 Web/Admin 消费端；本次响应结构与既有 `ExportDetail` / `PackingItem` / `ExpenseWithSplits` 契约一致，字段集合未变。

## 8. 建议下一步

1. **优先派单 trips owner**：在 DESTINATIONS_UPGRADE 收尾时一并把 `presentStop` / `presentParticipant` / `presentRevision` / `presentItineraryItem` / `presentActivity` 改成显式构造，并更新 `trip-origin.e2e-spec.ts` 的 `TripsRepository` mock（补 `createDestinations` / `findTrip`），让全量 API 测试恢复全绿。
2. **再派 admin owner**：`presentAdminAuditLog` / `presentEmailLog` / `presentFeatureFlag` 三处同样改成显式；这三张表也是长期加列的表。
3. **entries owner**：把 `entries.service.ts` 的两个 private presenter 改成显式透传（只挑 `presentEntry` / `presentRevision` 需要的字段），彻底断掉 `...record` 链。
4. **防复发门禁**：CI 增加一条 `rg`/lint 规则，禁止 `\.\.\.(record|row)\s*[,}]` 出现在 `*presenter*.ts` 或 `Schema.parse({` 附近；或加一个共享的 `expectPresenterIgnoresFutureColumns` 测试工具，要求每个 presenter 文件至少一条回归测试。
5. **契约生成后复验**：如果 contracts 后续再改实体字段，先跑 `pnpm --filter @roamlog/contracts test` + 本报告 4.2/4.4 的两条测试命令，确认 presenter 的实现与 schema 仍一一对应。