# W0_DB — Trip / Stop / place metadata migration

状态: DONE
任务 ID: W0_DB
角色: data_worker（只改数据库层，未触碰 API/Web/Admin/契约生成物）

## 变更文件

| 文件 | 变更 |
|---|---|
| `packages/db/prisma/schema.prisma` | M：`Trip` +4 可空字段，`Stop` +3 可空字段（29 插入 / 22 删除，删除行全部是 Prisma `format` 对 `Stop` 块的重排） |
| `packages/db/prisma/migrations/0003_w0_trip_stop_place_metadata/migration.sql` | A：7 列 + 6 个 CHECK，纯 additive |
| `packages/db/src/__tests__/migration.w0.test.ts` | A：11 个测试（6 静态契约一致 + 5 真实 PG 约束） |
| `.audit/w0-db-report.md`、`.audit/w0-db-report.checkpoint.md` | A：本报告与过程 checkpoint |

未修改：`packages/db/src/client.ts`、`packages/contracts/**`、`packages/api-client/**`、`apps/**`、compose/deploy、lockfile、其他 `.audit` 文件。
`git status` 中 `packages/api-mocks/*` 的改动是他人并行进行中，与本任务无关；未 `reset/clean/checkout/stash`，未提交。

### 迁移目录命名
任务写 `<timestamp>_w0_trip_stop_place_metadata`；仓库现有迁移为 `0001_init`、`0002_two_factor_state`（顺序号，非时间戳），且迁移按目录名排序。为"命名/风格与现有迁移一致"，采用 **`0003_w0_trip_stop_place_metadata`**，后缀保持原样。这是唯一与字面要求的偏差。

## 实现摘要

### Prisma（`schema.prisma`）
```prisma
model Trip {
  origin            String
  originLat         Float?
  originLng         Float?
  originCountryCode String?           @db.Char(2)
  timeZone          String?
  ...
}
model Stop {
  lat             Float?
  lng             Float?
  provider        String?
  providerPlaceId String?
  timeZone        String?
  ...
}
```
全部 nullable、无 `@default`；未改主键、未改现有列类型、未加 `@db.Uuid`/必填字段。

### 迁移 SQL（关键片段，`0003_w0_trip_stop_place_metadata/migration.sql`）
```sql
-- AlterTable
ALTER TABLE "Trip"
ADD COLUMN "originLat" DOUBLE PRECISION,
ADD COLUMN "originLng" DOUBLE PRECISION,
ADD COLUMN "originCountryCode" CHAR(2),
ADD COLUMN "timeZone" TEXT;

-- AlterTable
ALTER TABLE "Stop"
ADD COLUMN "provider" TEXT,
ADD COLUMN "providerPlaceId" TEXT,
ADD COLUMN "timeZone" TEXT;

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_coords_pair_check"
CHECK (("originLat" IS NULL) = ("originLng" IS NULL));

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_lat_range_check"
CHECK ("originLat" IS NULL OR "originLat" BETWEEN -90 AND 90);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_lng_range_check"
CHECK ("originLng" IS NULL OR "originLng" BETWEEN -180 AND 180);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_budget_amount_nonnegative_check"
CHECK ("budgetAmountMinor" IS NULL OR "budgetAmountMinor" >= 0);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_budget_pair_check"
CHECK (("budgetAmountMinor" IS NULL) = ("budgetCurrency" IS NULL));

ALTER TABLE "Stop"
ADD CONSTRAINT "Stop_provider_check"
CHECK ("provider" IS NULL OR "provider" IN ('photon', 'local'));
```

约束命名沿用 `0001_init` 的既有风格（`Trip_date_order_check`、`Expense_amount_nonnegative_check`）。SQL 内无 `CREATE TABLE`、无 `NOT NULL`、无 `DEFAULT`、无 `ALTER COLUMN`、无 `INSERT/UPDATE/DELETE`（测试断言同样覆盖这几点）。

## 验证命令与结果

运行环境：仓库内 embedded PostgreSQL 17.11（Windows x64），端口 `55441`，数据目录 `.data/w0-db-20261118/pgdata`，无 Docker。该 binary 包只带 `initdb/pg_ctl/postgres`（无 `psql/createdb`），建库与 SQL 校验用 `packages/db` 自带的 `pg` 驱动脚本完成。

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `codegraph status` | 0 | `[OK] Index is up to date`（1,339 files / 19,718 nodes / 41,594 edges） |
| 2 | `pnpm --filter @roamlog/db test`（无 TEST URL） | 0 | 4 files passed / 1 skipped；**26 passed, 6 skipped**；打印两条 SKIPPED 说明 |
| 3 | `pnpm --filter @roamlog/db typecheck` | 0 | `tsc --noEmit` 无输出 |
| 4 | `prisma migrate deploy`（空库 `roamlog_w0db`） | 0 | `0001_init` → `0002_two_factor_state` → `0003_w0_trip_stop_place_metadata`，`All migrations have been successfully applied.` |
| 5 | 目录校验（pg_catalog） | 0 | 7 列均为 `nullable=YES default=null`；`Trip.originLat/originLng` = `double precision`，`originCountryCode` = `character(2)`，其余 `text` |
| 6 | 约束校验（pg_catalog） | 0 | `Trip/Stop` 共 8 个 CHECK = 原有 2 个（date_order）+ 新增 6 个，全部在库 |
| 7 | 已有数据升级（`roamlog_w0db_existing`） | 0 | 先手工执行 0001+0002 → `migrate resolve --applied` 基线 → 插入 1 user/1 workspace/1 member/1 trip/1 stop → `pnpm db:migrate`：只应用 `0003_w0_trip_stop_place_metadata`；`migrate status` = `Database schema is up to date!` |
| 8 | 旧行保留校验 | 0 | `{"title":"Legacy trip","origin":"Berlin","budgetAmountMinor":250000,"budgetCurrency":"EUR","originLat":null,"originLng":null,"originCountryCode":null,"timeZone":null}`；Stop 的 `provider/providerPlaceId/timeZone` 均 `null` |
| 9 | 约束负例（在旧库上逐项执行） | 0 | 5/5 全部 `code=23514`：`Trip_origin_coords_pair_check` / `Trip_budget_amount_nonnegative_check` / `Trip_budget_pair_check` / `Trip_origin_lat_range_check` / `Stop_provider_check` |
| 10 | 合法写入 | 0 | 旧 trip 写入 `52.52/13.405/DE/Europe/Berlin` + stop 写入 `photon/photon-1` 成功（随后 ROLLBACK，不污染数据） |
| 11 | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | 0 | `No difference detected.`（空库 schema 与 migration 历史无漂移） |
| 12 | `ROAMLOG_TEST_DATABASE_URL=… pnpm --filter @roamlog/db test` | 0 | **32 passed / 32**（含 `migration.w0.test.ts` 11/11 真实 PG 约束测试、`seed.integration.test.ts` 1/1） |
| 13 | `pg_ctl stop -m fast` | 0 | `server stopped`；`postmaster.pid` 已删除；保留 `.data/w0-db-20261118/{pgdata,pg.log}` |

## 截图 / 日志 / 接口证据

- PG 日志：`.data/w0-db-20261118/pg.log`（89 行，含 `database system is ready to accept connections` 与 shutdown checkpoint）。
- 迁移历史（`_prisma_migrations`）：`0001_init`、`0002_two_factor_state`、`0003_w0_trip_stop_place_metadata` 三条 `finished_at` 均非空。
- 约束定义实例（`pg_get_constraintdef`）：
  - `Trip_origin_coords_pair_check`: `CHECK ((("originLat" IS NULL) = ("originLng" IS NULL)))`
  - `Trip_budget_pair_check`: `CHECK ((("budgetAmountMinor" IS NULL) = ("budgetCurrency" IS NULL)))`
  - `Stop_provider_check`: `CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['photon'::text, 'local'::text]))))`
  - `Trip_origin_lat_range_check`: `CHECK ((("originLat" IS NULL) OR (("originLat" >= ('-90'::integer)::double precision) AND ("originLat" <= (90)::double precision))))`
- 无 HTTP/接口证据：本任务不涉及 API，且未启动 Web/Admin。

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`。
- `codegraph explore "Trip Stop budgetAmountMinor budgetCurrency schema.prisma migration"` → `Found 47 symbols across 8 files`；blast radius 指向后续必须由契约/API owner 处理的消费者：
  - `TripSchema`（`packages/contracts/src/entities/trip.ts:96`）— 11 callers：`packages/api-mocks/src/fixtures.ts`、`apps/api/src/modules/trips/content-presenters.ts`、`apps/web/lib/api/mock.ts`、`apps/web/lib/api/real.ts` 等；
  - `AmountMinorSchema`（`packages/contracts/src/common/money.ts:12`）— 12 callers（`api/trips.ts`、`entities/trip.ts` 等）；
  - `Stop`（`packages/api-client/src/generated/schemas/stop.ts:10`）— 3 callers（`endpoints/stops/stops.ts`）；
  - `PublicTripResponseBudget` / `PublicTripResponseStopsItem` — 公开分享投影同样受影响。
- 结论：CodeGraph 不索引 `.prisma`/`migration.sql`，本次变更是"新增可空字段"，对现有 TS 代码无编译期依赖；真正需要联动的是契约（新增字段暴露）与 API presenter。
- 额外只读核对：`apps/api` 中 `budgetAmountMinor` 共 19 处命中，已有 `assertBudgetPair`（`apps/api/src/modules/trips/content-values.ts:62`）在创建/更新时强制 amount+currency 成对 —— DB CHECK 与服务层规则一致，不会把现有 PATCH 路径打挂。

## 已知风险

1. **预算 PATCH 必须成对写入**：DB 现在强制 `budgetAmountMinor` 与 `budgetCurrency` 同空同非空。服务层已有 `assertBudgetPair`，但任何绕过服务层直接写库的脚本/后台任务在只改单边时会被 23514 拒绝。这是规格要求的完整性，不是缺陷。
2. **`CHAR(2)` 语义**：`originCountryCode` 用 `CHAR(2)`，PostgreSQL 会对短于 2 字符的值补尾随空格（如 `'F'` → `'F '`），Prisma 读回会带空格。API/校验层应保证只写 2 位大写国家码（contracts 已有 `CountryCodeSchema`），DB 未额外加格式 CHECK（任务未要求）。
3. **Check 约束无法被 Prisma 表达**：`schema.prisma` 的 datamodel 不含 CHECK，`migrate diff` 只比较 Prisma 可表达对象，所以"无漂移"不能反证 CHECK 存在——CHECK 由 `migration.w0.test.ts` 的静态断言 + 真实 PG 测试双重兜底。
4. **`Stop` 块重排**：`prisma format` 因新增 `providerPlaceId`（比原最长字段宽）重排了整个 `Stop` 块（22 行）。这是 canonical 格式，非手工噪声，但会让 review 看到较多行；`Trip` 块无重排。
5. **迁移目录名用顺序号**而非时间戳（见上），若后续工具期望时间戳前缀需统一。

## 未覆盖项

- **`Stop` 复合索引**：审计 11.1 表格提到"地点去重/查询"的复合索引。本任务显式列出的目标只有 3 列 + 4 类约束，未包含索引，故未添加（避免超范围改动）。建议由根 Agent 决定是否追加一个非唯一索引（如 `("workspaceId","provider","providerPlaceId")`，安全、可后续单独迁移）。
- **不校验 IANA 时区字符串**：`timeZone` 仅 `TEXT`，未在 DB 层做 IANA 合法性校验（任务只要求"IANA 名称"语义，未要求 CHECK）。
- **未做时区/几何回填**：按规格只新增可空列，无数据重写。
- **契约/API/Web 投影**：`TripSchema`、`StopSchema`、`PublicTripResponse`、`api-client` 尚未暴露新字段（禁止修改，属其他 owner）。
- **未做 down migration**：与仓库现有迁移一致（`docs/operations/migrations.md` 明确 roll-forward 优先）。
- **未在 staging/容器内验证**：本任务限定无 Docker 的 embedded PG。

## 建议的下一步

1. 由契约 owner（Wave 0 contracts）在 `entities/trip.ts` / `entities/stop.ts` 增加 `originLat/originLng/originCountryCode/timeZone`、`provider/providerPlaceId/timeZone`（可空），再重生成 `openapi.json` 与 `api-client`；本任务已确认 DB 侧可承接。
2. 由 API owner 在 trip/stop presenter 与 PATCH 校验中透传/收敛这些字段（预算仍走 `assertBudgetPair`；补 `timeZone` IANA 校验与 `provider` 枚举复用 `photon|local`）。
3. 决定是否追加 `Stop` 地点去重索引（非唯一，单独迁移，`0004_*`），以及是否给 `originCountryCode` 加 `~ '^[A-Z]{2}$'` CHECK。
4. Release operator 在真实 staging 按 `docs/operations/migrations.md` 流程执行 `prisma migrate deploy`，归档 `prisma migrate status` 与迁移日志（本任务已在空库 + 有数据副本上验证）。
