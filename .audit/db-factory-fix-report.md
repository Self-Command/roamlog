# DB_FACTORY_FIX — factories.ts TS2719 最小修复报告

状态: DONE（db 包范围全绿；api typecheck 剩余错误全部属于并行 trips Agent 的在途文件，详见“已知风险”）
任务 ID: DB_FACTORY_FIX
完成时间: 2026-11-18 21:07 (+08:00 Asia/Shanghai)

## 变更文件

- `packages/db/src/factories.ts`（唯一代码改动，+4 行，无删除、无重排）
- `.audit/db-factory-fix-report.md`（本报告）
- `.audit/db-factory-fix-report.checkpoint.md`

未触碰：`packages/db/prisma/schema.prisma`、`migrations/**`、`packages/db/src/generated/**`、其它 `packages/**`、`apps/**`、compose、lockfile、其它 `.audit` 文件。

## 实现摘要

迁移 `0003_w0_trip_stop_place_metadata` 给 Prisma `Trip` 增加了 4 个“必填但可空”字段（`originLat`、`originLng`、`originCountryCode`、`timeZone`）。这些列在 migration SQL 里都是 nullable、无默认值，因此 Prisma 结果类型要求键必须存在、值可为 `null`。原 `makeTrip` 只在末尾 `...overrides`（`Partial<Trip>`）里带入这些键，类型被推断为 `number | null | undefined`，触发 TS2719。

修复（`packages/db/src/factories.ts` L97–L100）：

```ts
origin: "Factory origin",
originLat: null,
originLng: null,
originCountryCode: null,
timeZone: null,
destinations: [],
```

- `...overrides` 仍保持在字面量最后一位，位置语义未变：调用方可用 `makeTrip({ originLat: 31.23, originLng: 121.47 })` 覆盖新字段。
- 只补新迁移引入的字段，未改动任何既有字段、未重构、未新增导出。

### makeStop / Stop 工厂核查

`codegraph explore "makeTrip makeStop factories Trip Stop"` 明确返回 `makeStop` “not in the index”；`ops_grep "makeStop"` 全仓 0 命中；`packages/db/src/factories.ts` 现有工厂仅为 `makeUser`、`makeWorkspace`、`makeMember`、`makeTrip`、`makeEntry`、`makeExpense`、`makePackingItem`、`makeMedia`，**没有任何构造 Prisma `Stop` 的工厂**。因此迁移 0003 的 Stop 新列（`provider`、`providerPlaceId`、`timeZone`）在本包内无工厂字面量需要补默认值；api 侧 `prisma.stop.create` 走 CreateInput（列可省略），不产生同型错误。此项结论为“不存在，无需修改”，未擅自新增 `makeStop`。

### 其它模型同类问题排查

- 迁移 0003 只 ALTER 了 `Trip` 与 `Stop` 两张表，其它模型不受新列影响。
- `pnpm --filter @roamlog/db typecheck` 修复后 exit 0，说明本包内不存在第二处“新列只来自 spread”的 TS2719。
- `schema.prisma` 由 W0_DB 并行 Agent 修改（`git status` 显示 `M packages/db/prisma/schema.prisma`），本任务未写入。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `codegraph status` | `[OK] Index is up to date`（改前 1,373 files / 20,397 nodes；改后复查仍 up to date，watcher 已增量同步） |
| `pnpm --filter @roamlog/db typecheck` | **exit 0**（修复前：`src/factories.ts(87,3): error TS2719 ... originLat ...`；修复后无输出） |
| `pnpm --filter @roamlog/api typecheck` | exit 2，**0 个 `packages/db` 错误**；6 个错误全部在 `apps/api/src/modules/trips/trips.service.ts` 与 `apps/api/test/content-trips.e2e-spec.ts`（见下） |
| `pnpm --filter @roamlog/db test` | **通过**：4 passed / 1 skipped（`vitest` 26 passed / 6 skipped；跳过项均为未设 `ROAMLOG_TEST_DATABASE_URL` 的 migration 0003 与 seed 集成用例；`prisma validate` 通过） |
| `git diff -- packages/db/src/factories.ts` | 仅 4 行新增（`1 file changed, 4 insertions(+)`），见上方 diff 片段 |

`git diff` 原始输出：

```diff
@@ -94,6 +94,10 @@ export function makeTrip(overrides: Partial<Trip> = {}): Trip {
     endDate: fixedNow,
     coverMediaId: null,
     origin: "Factory origin",
+    originLat: null,
+    originLng: null,
+    originCountryCode: null,
+    timeZone: null,
     destinations: [],
```

## CodeGraph 证据

1. `codegraph status`：
   `Project: C:\Users\BY9700\Desktop\UI\roamlog / Files: 1,373 / Nodes: 20,397 / Edges: 43,359 / [OK] Index is up to date`
2. `codegraph explore "makeTrip makeStop factories Trip Stop"`（61 symbols / 8 files）关键结果：
   - `makeTrip (packages/db/src/factories.ts:85)` — 1 caller `packages/db/src/index.ts`；间接测试 `apps/api/test/admin-audit-uuid-compat.e2e-spec.ts`、`auth-two-factor.integration.e2e-spec.ts` 等 → blast radius 局限在工厂导出与 api 测试夹具。
   - `makeStop` **不在索引中**（明示 “Not in the index”），与全仓 grep 0 命中一致 → Stop 工厂不存在。
   - 关联面：`findTrip (apps/api/src/modules/trips/stops.repository.ts:44)` → `stops.service.ts`，属 trips Agent 领域，不在本任务可写范围。

## 已知风险

1. **api typecheck 仍未绿，但不再由 `packages/db` 引起**。剩余 6 个错误全部在并行 trips Agent 的在途文件，owner = trips 模块 Agent（`apps/api/src/modules/trips/**`、`apps/api/test/content-trips.e2e-spec.ts`）：
   - `trips.service.ts(15,8)` TS6133 `TripCover` 未使用
   - `trips.service.ts(55,48)` TS6138 `covers` 未使用
   - `trips.service.ts(114,31)` TS2339 `resolveCovers` 不存在于 `TripsService`
   - `trips.service.ts(145,13)` / `(307,60)` TS2739/TS2345：`TripCreateData`（`apps/api/src/modules/trips/trips.repository.ts:14` 本地接口）缺 `originLat/originLng/originCountryCode/timeZone` —— 这是 **api 侧适配 0003 契约的缺口**，不是 `packages/db` 工厂问题
   - `apps/api/test/content-trips.e2e-spec.ts(45,19)` TS2554：`new TripsService(...)` 传 3 个参数，构造函数已注入第 4 个依赖 `TripCoverService`
   按要求未修复，交回 trips Agent。
2. `originLat/originLng` 的成对 CHECK、`provider` 枚举 CHECK 属于数据库约束，工厂只给 `null`，不覆盖越界/半对值路径；这类边界由 W0_DB 的 `migration.w0.test.ts` 在设置 `ROAMLOG_TEST_DATABASE_URL` 后负责。
3. 修复只保证类型层；`makeTrip` 的调用方若依赖“对象上不存在该键”的旧行为（未发现此类调用），会看到显式 `null`。`git grep` 未见相关断言。

## 未覆盖项

- 未运行真实 PostgreSQL 集成测试（无 `ROAMLOG_TEST_DATABASE_URL`），CHECK 约束未实测。
- 未新增 `makeStop` 工厂，也未覆盖任何 Stop 夹具；若后续 Agent 需要，应作为独立任务在 `packages/db/src/factories.ts` 增加（本任务范围外）。
- api e2e / web / admin 未运行 —— 超出本任务范围且正被并行 Agent 修改。

## 建议的下一步

1. 把本报告“已知风险 1”原样转给 trips Agent：补齐 `TripCreateData` 的 4 个新字段（`originLat/originLng/originCountryCode/timeZone`），实现 `TripCoverService.resolveCovers` 并更新 `content-trips.e2e-spec.ts` 构造函数参数；随后重跑 `pnpm --filter @roamlog/api typecheck`。
2. 若 api 侧希望测试夹具也覆盖 Stop 新列，由根 Agent 另开任务新增 `makeStop`（需同时改 `packages/db/src/index.ts` 导出）。
3. 合并前在具备测试库的环境执行 `pnpm --filter @roamlog/db test` 以激活 migration 0003 集成用例。