# ADMIN_API_500S — 两个真实 500 的根因与修复

状态: DONE
日期: 2026-11-20
工作目录: `C:\Users\BY9700\Desktop\UI\roamlog`
本地 DB: `postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public`
测试 DB: `roamlog_ci`（同实例）

## 1. 真实堆栈（原文）

获取方式：用 `tsx` 直连本地 `roamlog_local`，把 `AuditService` / `AdminContentService` 读路径用到的
Prisma 查询 + presenter + `toCursorPage` 原样执行（`apps/api` 的控制器最终就是这三步），
输出见 `.audit/admin-500/probe2.log`。先在真实 PostgreSQL 上跑回归用例（未改代码）复现出
三个端点 500，再取的堆栈。

### 1.1 `/v1/admin/audit`、`/v1/admin/audit/export`

```
=== presentAdminAuditLog #1 :: THROWN ===
name: ZodError
message: [
  {
    "origin": "string",
    "code": "invalid_format",
    "format": "uuid",
    "pattern": "/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/",
    "path": [
      "targetId"
    ],
    "message": "Invalid UUID"
  }
]
ZodError: [ ... 同上 ... ]
    at presentAdminAuditLog (C:\Users\BY9700\Desktop\UI\roamlog\apps\api\src\modules\admin\admin.presenters.ts:35:25)
    at <anonymous> (C:\Users\BY9700\Desktop\UI\roamlog\.audit\admin-500\probe2.mts:28:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

=== toCursorPage audit :: THROWN ===
ZodError: [ ... 同一 targetId 错误 ... ]
    at presentAdminAuditLog (...\admin.presenters.ts:35:25)
    at Array.map (<anonymous>)
    at toCursorPage (...\apps\api\src\common\services\cursor-page.ts:27:20)
```

### 1.2 `/v1/admin/trips`

```
workspace 019b7946-1c12-72e5-b2f5-ba152dee90d6 trip rows: 25

=== toCursorPage trips :: THROWN ===
name: ZodError
message: [
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [
      "cover"
    ],
    "message": "Invalid input: expected object, received number"
  }
]
ZodError: [ ... 同上 ... ]
    at presentTrip (C:\Users\BY9700\Desktop\UI\roamlog\apps\api\src\modules\trips\content-presenters.ts:139:21)
    at Array.map (<anonymous>)
    at toCursorPage (C:\Users\BY9700\Desktop\UI\roamlog\apps\api\src\common\services\cursor-page.ts:27:20)
    at <anonymous> (C:\Users\BY9700\Desktop\UI\roamlog\.audit\admin-500\probe2.mts:62:18)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
```

（第二个 workspace 只有 1 条 trip，同样在 `cover` 上炸——所以与 `workspaceId` 无关。）

## 2. 根因

### 2.1 audit / audit/export

- 不是缺列、不是缺分页默认值。Prisma `auditLog.findMany` 原样执行成功（15 行）。
- `presentAdminAuditLog` 用契约 `AuditLogSchema` 校验每一行，而 `targetId` 是 `z.uuid()`：
  Zod v4 的 uuid 规则要求 RFC 4122 的 version/variant nibble（`[89abAB]`）。
- 库里 10 行 `ai.tool_call`（`targetType=ai_tool`）的 `targetId` 都是
  `726d652a-fcfc-877c-f34f-593a6ec94c59`：variant nibble 是 `f`，RFC 4122 不接受。
- 它的来源可从同一行的 metadata 看到：`metadata.runId = "726d652afcfc877cf34f593a6ec94c59"`
  ——AI planner 的 `newRunId()`（`apps/api/src/modules/ai/ai-run.store.ts:31`）返回
  32 位无连字符 hex；`AuditService.record()` 把它直接写进 PostgreSQL `uuid` 列，
  PostgreSQL 接受并规范化成带连字符形式（不改写 version/variant）。
- audit 行不可变，历史数据无法"修好"，于是**一行坏数据让整个列表页 + CSV 导出 500**。

### 2.2 trips

- `AdminContentService.listTrips` 写的是 `toCursorPage(rows, limit, presentTrip)`。
- `presentTrip(record, cover = null)` 有**第二个参数**，而 `toCursorPage` 内部是
  `visible.map(map)`：`Array.prototype.map` 会把数组下标作为第二参数传入，
  于是第 0 行 `cover = 0`、第 1 行 `cover = 1`……`TripSchema.parse` 对 `cover`
  要求 object/null，得到 number → ZodError。
- 所以**只要结果集非空就 500**；带 `workspaceId` 只是换了过滤条件，不是触发器。
  同模块的 `presentEntry/presentComment/presentMedia/presentEmailLog` 都只有一个参数，
  因此只有 trips 炸（已逐个核对签名）。

## 3. 修复内容

仅后端读路径，未改契约、未改 UI、未改 AI 模块：

1. `apps/api/src/modules/admin/admin-content.service.ts`
   `toCursorPage(rows, query.limit, (row) => presentTrip(row))` —— 截断 `map` 的第二参数。
2. 新增 `apps/api/src/modules/audit/audit-read.ts`
   `AuditLogReadSchema = AuditLogSchema.extend({ id/actorId/targetId/workspaceId: PostgresUuid }).strict()`，
   其中 `PostgresUuid` = `8-4-4-4-12 hex`（PostgreSQL `uuid` 的实际入参/出参形态），
   其余字段和 unknown-key 拒绝规则仍然来自契约。理由写在该文件注释里：
   数据库已接受的不可变历史行必须可读。
3. `apps/api/src/modules/admin/admin.presenters.ts` 的 `presentAdminAuditLog`
   与 `apps/api/src/modules/audit/audit.service.ts` 的 `presentAuditLog`
   改用 `AuditLogReadSchema`（后者是 workspace 审计端点，同一 presenter 缺陷）。

## 4. 回归测试

| 文件 | 类型 | 结果 |
| --- | --- | --- |
| `apps/api/test/admin-api-500-regression.e2e-spec.ts` | e2e，真实 PostgreSQL `roamlog_ci` | 3 passed（改前 3 failed/500） |
| `apps/api/src/modules/audit/__tests__/audit-read.spec.ts` | unit | 4 passed |
| `apps/api/src/modules/audit/__tests__/audit.service.spec.ts` | unit（+1 非 RFC uuid 用例） | 4 passed |
| `apps/api/src/modules/admin/__tests__/*`（14 个文件） | unit | 全部通过 |
| `apps/api/test/admin-audit-uuid-compat.e2e-spec.ts`（既有） | e2e，真实 PostgreSQL | 1 passed（未回归） |

合计 17 文件 / 135 tests passed。

e2e 用例覆盖：
1. `GET /v1/admin/audit` 200 且包含 variant-`f` 行（`targetId` 原样返回），`items.length >= 2`；
2. `GET /v1/admin/audit/export` 200 + `text/csv`，CSV 内含同一行；
3. `GET /v1/admin/trips?workspaceId=` 200，`cover: null`、`durationDays: 3`；不带过滤也 200。

红→绿证据：同一 spec 在修复前 3 个用例均为 500（日志见交付说明）。

## 5. 真实 HTTP 证据

运行环境：为拿到 **修复后代码的真实 HTTP**，在 `:4100` 起了同一个 API 的临时实例
（同一份 `roamlog_local` 数据、同一 `.env.local`、`BETTER_AUTH_URL`/`API_URL` 改为 4100），
验证后已 kill；`:4000` 上你正在跑的实例**未重启、未触碰**。

修复后（4100）：
- `GET /v1/admin/audit?limit=5` → **200**，`items.length=5`，`hasMore=true`；
  第 2 条即 `{"action":"ai.tool_call","targetId":"726d652a-fcfc-877c-f34f-593a6ec94c59","actorType":"user","workspaceId":"01a1f7a6-..."}`
- `GET /v1/admin/audit?limit=20` → **200**，`items.length=15`，`hasMore=false`
- `GET /v1/admin/audit/export` → **200** `text/csv; charset=utf-8`，6807 bytes，首行表头 + 同上 targetId
- `GET /v1/admin/trips?workspaceId=019b7946-...` → **200**，`items.length=25`
- `GET /v1/admin/trips?workspaceId=...&limit=5&sort=updatedAt%3Adesc`（admin UI 详情页原文请求）→ **200**，`items.length=5`
- `GET /v1/admin/trips`（无过滤）→ **200**，`items.length=26`
- `GET /v1/admin/workspaces/019b7946-...` → **200**
- 对照 `GET /v1/admin/system` → 200

修复前（4000，旧代码，同账号同库）：`audit` 500 / `audit/export` 500 / `trips?...` 500 / `system` 200。

复跑脚本：`.audit/admin-500/evidence.mjs`、`.audit/admin-500/evidence-page.mjs`（`API_BASE=...`）。

## 6. 数据库前后对比

只读取、不写库；对比的是「HTTP 载荷 ↔ SQL 真值」，改前改后 SQL 侧完全没变：

```
AuditLog: total=15, non_rfc=10, checksum=716a3d304fa554ff38403cfd994ff01a
Trip: total=26（roamlog-crew 25 + Verify Owner 1）
variant row: id=01a1f7f7-41cf-..., action=ai.tool_call, targetType=ai_tool,
             targetId=726d652a-fcfc-877c-f34f-593a6ec94c59,
             metadata.runId=726d652afcfc877cf34f593a6ec94c59
```

`/v1/admin/trips?workspaceId=roamlog-crew` 的 25 条 = SQL 该 workspace 的 25 条；
无过滤 26 条 = SQL total 26。修复（读路径）前后 checksum/counts 不变，未重写任何审计行。

## 7. 验证命令

```bash
# 类型
cd apps/api && node ../../node_modules/typescript/bin/tsc --noEmit        # exit=0
# 单测 + 真实 PG e2e
cd apps/api && ROAMLOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_ci?schema=public' \
  node ../../node_modules/vitest/vitest.mjs run src/modules/admin src/modules/audit \
  test/admin-api-500-regression.e2e-spec.ts test/admin-audit-uuid-compat.e2e-spec.ts   # 135 passed
# lint
cd apps/api && node ../../node_modules/eslint/bin/eslint.js <changed files>  # exit=0
# codegraph
cd roamlog && codegraph status                                             # [OK] Index is up to date
```

## 8. CodeGraph 证据

`codegraph_explore`（projectPath=`C:\Users\BY9700\Desktop\UI\roamlog`）：
1. `admin audit controller listAudit export; admin trips listTrips workspaceId`
   → 命中 `AdminContentService.listTrips`（admin-content.service.ts:41）、
   `AdminContentController.listTrips`(:32)、`AdminAuditService.list`(:48)。
2. `admin-audit.service.ts ... admin-selects.ts ...`
   → 命中 `auditSelect`、`exportCsv`、`presentAdminAuditLog`，确认读路径无分页/列缺失。
3. `presentTrip content-presenters.ts cursor-page.ts AuditLogSchema TripSchema cover`
   → 命中 `presentTrip(record, cover = null)` 签名、`toCursorPage` 的 `visible.map(map)`、
   `TripSchema.strict()`、`AuditLogSchema` 的 `AuditRecordUuidSchema = z.uuid()`。
4. `audit.service.ts AuditService ...` → 命中 workspace `presentAuditLog` 同一缺陷。
blast radius：`listTrips` 2 个 controller 调用方；`cursorId` 42 个调用方（未改公共函数，避免连带风险）。

## 9. 已知风险 / 未覆盖

1. **契约仍然比数据库窄**：`packages/contracts/src/entities/audit-log.ts` 的
   `AuditRecordUuidSchema` 还是 `z.uuid()`，OpenAPI 仍是 `format: uuid`。API 现在会返回
   PostgreSQL 规范化后、非 RFC 的 uuid 字符串。已在 `apps/admin` 中确认：审计列表**没有**
   客户端 Zod 校验（没有引用 `AuditLogSchema`/`AdminAuditPageSchema`），所以页面能显示；
   但后续谁用 `AdminAuditPageSchema` 校验响应仍会被拒。建议契约负责人把该 schema 放宽为
   同一条 PostgreSQL uuid 规则（文件注释里本来就写着"历史行必须可读"）。
2. **写入方缺陷（AI 模块，属其他 agent）**：`ai-run.store.ts:31` 的 `newRunId()`
   返回无连字符 hex，`ai-execute.service.ts:163` 把它当 `AuditLog.targetId` 写 `uuid` 列。
   建议改为 `randomUUID()` 或真正 UUIDv7，避免继续产生非 RFC 值。我未改 AI 文件。
3. workspace 审计端点 `GET /v1/workspaces/:id/audit` 有同一 presenter 缺陷，已用共享 schema 修好，
   但只有单测覆盖（其 HTTP 覆盖需要租户/角色 guard + 成员 fixture，未接入）。
4. 没有 UI 点击验证：`apps/admin/**` 禁改，且 `:4000` 仍是旧代码（等你重启）。
   已用 admin UI 的**原文请求**验证 HTTP 层（见 §5），重启后请在浏览器复核
   `/admin/audit` 与 `/admin/workspaces` 详情页。
5. 只处理了 admin/audit 读路径。`map` 回调误传第二参数这一类缺陷只对 admin 模块逐签名核对过，
   其他模块未穷举。
6. 未清理任何数据：那 10 行 `ai.tool_call`（以及 `PRODCOPY-*` trip）是其他 agent 的 e2e 写入的
   本地脏数据，审计行不可变，不属于本任务处置范围。

## 10. 为什么没有 UI 可点

纯后端读路径缺陷修复：没有新增/修改任何页面、组件或交互；两个页面此前"只能显示失败态"
是因为它们请求的 API 返回 500。按 §00.1 纯后端验收口径给了真实 HTTP 响应 + 数据库对比；
浏览器复核依赖 API 重启，由你执行。