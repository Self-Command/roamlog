# DESTINATIONS_UPGRADE — 结构化旅行目的地报告

状态: **DONE**（全部必须项 + 验证完成；未覆盖项见第 10 节）
任务 ID: `DESTINATIONS_UPGRADE`
角色: data_worker + backend_api + web_frontend
时间: 2026-11-19（Asia/Shanghai）
范围: `packages/db/prisma/{schema.prisma,migrations/0010_*}`、`packages/db/src/**`、`packages/contracts/src/{entities/trip.ts,api/trips.ts,__tests__/trips.test.ts,__tests__/entities.test.ts}`、`apps/api/src/modules/trips/**`、`apps/web/components/trips/trip-form/**`、`.audit/destinations-report.md`

---

## 1. 变更文件

### 数据库（commit 1）

- `packages/db/prisma/schema.prisma`
  - 新增 `model TripDestination`（UUIDv7 主键、`VARCHAR(160)` 名称、provider/placeId/address/country/countryCode/lat/lng/timeZone/bbox/order、`deletedAt` 软删、`trip` 级联外键、`@@index([tripId, order])`）。
  - `Trip` 增加关系 `destinationsV2 TripDestination[]`，`destinations String[]` 加 `/// @deprecated` 文档注释。
- `packages/db/prisma/migrations/0010_trip_destinations/migration.sql`（新增）
- `packages/db/src/factories.ts`：新增 `makeTripDestination()`。
- `packages/db/src/__tests__/schema.test.ts`：新增模型结构断言（partial unique 只能存在于迁移里）。
- `packages/db/src/__tests__/migration.0010.integration.test.ts`（新增，真实 PG）。
- `packages/db/src/__tests__/migration.0009.test.ts`：0010 成为最新迁移后，把“0009 是最新”的断言改为“0009 排在 8”。

### 契约（commit 2）

- `packages/contracts/src/entities/trip.ts`
  - 新增 `TripDestinationProviderSchema`（`geoapify|photon|local`，与 `PlaceSearchProviderSchema` 同值集，测试锁定）。
  - 新增 `TripDestinationSchema`（12 个字段 + `order`，`.strict()`，lat/lng 成对校验）。
  - `TripSchema` 增加 `destinationsV2: TripDestination[]`（可选读取），`destinations` 标记 deprecated；旧 `destinations` 数组单项上限 120 → **160**（原因见第 4 节）。
- `packages/contracts/src/api/trips.ts`
  - 新增 `TripDestinationInputSchema` / `TripDestinationInputListSchema`（≤30、名称大小写不敏感去重）。
  - `CreateTripRequestSchema` / `UpdateTripRequestSchema` 增加 `destinationsV2?: ...`。
- `packages/contracts/src/__tests__/trips.test.ts`（新增，8 条）：省略 `destinationsV2` 的回归、仅名称、完整元数据往返、显式 null、半坐标拒绝、未知键拒绝、31 个/重名拒绝、空数组清空。
- `packages/contracts/src/__tests__/entities.test.ts`：新增 5 条结构化目的地实体测试。
  - ⚠️ 该文件在我开始前已被 **share-links Agent** 修改（`PublicStop.provider`，+5 行未提交）。我只追加了自己的 5 条测试，**没有提交该文件**，见第 9 节。

### API（commit 3）

- `apps/api/src/modules/trips/content-records.ts`：新增 `TripDestinationRecord`；`TripRecord.destinationsV2?`。
- `apps/api/src/modules/trips/content-presenters.ts`
  - `PresentTripDestinationInput` + `PresentTripInput.destinationsV2?`。
  - `presentTrip()` **逐字段显式构造**（无整行 spread）：过滤软删、按 `order`/`id` 排序、归一化 bbox；`destinations` 由 V2 行派生 name 数组（无行时回退旧列）。
- `apps/api/src/modules/trips/trips.repository.ts`
  - `findTrip` / `listTrips` 增加 `destinationsV2` include（`deletedAt: null`、`order asc`）。
  - 新增 `createDestinations` / `replaceDestinations`（整组软删 + 插入）/ `softDeleteDestinations`。
  - `TripDestinationWriteData` 类型。
- `apps/api/src/modules/trips/trips.service.ts`
  - create：有 V2 → 插行 + 旧列写 names；事务内重读返回完整行。
  - update：有 V2 → 版本条件更新成功后在**同一事务**内整组替换；旧列同时镜像 names；未传 V2 → 不动行。
  - duplicate：复制源 trip 的全部活跃目的地行（新的 tripId、保留 order/元数据）。
  - remove：软删 trip 时级联软删目的地。
- 测试：新增 `trips-destinations.spec.ts`（11 条）；`trips-origin-address.spec.ts`、`trips-origin-location.spec.ts` 补 repository 桩并让 create 重读返回创建行。

### Web（commit 4，含本报告与 E2E 脚本）

- `apps/web/components/trips/trip-form/trip-form-state.ts`
  - `TripFormDestination`（含 `id`，仅用于回显/升级，不提交）；`destinationFromPlace` / `manualDestination` / `destinationsFromTrip` / `destinationInput` / `sameDestinationGroup`。
  - `valuesFromTrip`：V2 优先并按 order；只有旧 names 的 trip 映射为 name-only 行。
  - `buildCreateTripRequest`：提交 `destinationsV2`（不再发送 deprecated `destinations`）。
  - `buildUpdateTripRequest`：按顺序 + 元数据深比较，变化才发 `destinationsV2`（含空数组清空）。
  - `deriveCountryCodes` 改从每行 `countryCode` 推导；`mapServerField` 增加 `destinationsV2.*` → `destinations`。
- `apps/web/components/trips/trip-form/destinations-field.tsx`（重写）
  - 与起点同款 `SearchableCombobox` + `searchPlacesForTripForm`（由 `trip-form.tsx` 注入 search/`resolvePlace`，复用起始地点的 `placeIndex`）。
  - 选中后存 `name/provider/providerPlaceId/address/country/countryCode/lat/lng/timeZone/bbox`。
  - 手动录入 = `provider: "local"`、坐标/地址/时区为 null。
  - 每行展示 provider 徽标（地点库/手动地点/**仅名称**）、完整地址、时区、坐标；上/下移按钮（无拖拽库）。
  - 每行“搜索替换”按钮可把旧 names-only 行升级为真实地点（或替换为手输名称）。
- `apps/web/components/trips/trip-form/trip-form.tsx`：新 props 接线、增/删/替换/移动、右侧预览改用 `destination.name/countryCode`。
- 测试：
  - `__tests__/trip-form.test.tsx` 新增 `TripForm structured destinations` 4 条（搜索选中完整 payload / 编辑回显且不重写 / 顺序调整 / legacy 升级）。
  - `__tests__/trip-form-state.test.tsx`、`__tests__/places-attribution.test.tsx` 适配新结构。
  - `apps/web/lib/api/trip-form.ts` **无需修改**（`TripSchema` 解析，V2 字段随响应透传）。
- 证据脚本：`.audit/local-verify/destinations-e2e.sh`、`destinations-e2e.mjs`。

---

## 2. 实现摘要（逐 5 项）

1. **数据模型**：新表而非 jsonb 数组，支持单行更新/删除；`order` 顺序由服务端按数组下标写入；软删保留历史。
2. **契约**：`TripDestinationSchema` + `destinationsV2` 与旧 `destinations` 并存；请求侧真正 `.optional()`；读取侧服务端始终返回 V2。
3. **API**：create/update（整组替换、事务）/ duplicate（复制行）/ remove（级联软删）；presenter 显式构造。
4. **Web**：目的地字段升级为可搜索地点选择，元数据完整落库并回显；支持手动、顺序调整、legacy 升级。
5. **测试**：真实 PG 迁移（空库/存量/CHECK/partial unique/级联）、契约回归、API 写读/替换/复制/级联、Web payload/回显/顺序/升级、presenter 未知列回归。

### 关键决策与偏离说明

1. **`@@unique([tripId, order])` 换成 partial unique index**（`WHERE "deletedAt" IS NULL`，索引名 `TripDestination_tripId_order_active_key`）。理由：“整组替换”先软删再插入同位置行，普通唯一约束会让被软删的行挡住自己的替代行；partial 索引仍保证“同一 trip 同一位置最多一条活跃行”。Prisma 不支持 partial index，因此它只存在于迁移 SQL（`schema.prisma` 只保留 `@@index([tripId, order])`，与 0001 的 owner partial index 同一模式）。
2. **`TripDestination.id` 加了 `@default(uuid(7))`**（任务给的模型片段没有 default）。理由：Prisma create/createMany 需要主键；仓库所有模型都用 `uuid(7)`，契约 `UuidV7Schema` 也要求 v7。
3. **迁移回填用 `unnest(...) WITH ORDINALITY`，不是 `jsonb_array_elements_text`**。理由：Prisma `String[]` 在 0001 里是 `TEXT[]`，`jsonb_array_elements_text(text[])` 不存在（实测 SQLSTATE 42883）。仍是纯 SQL 集合式回填；`jsonb_array_elements_text` 需先 `to_jsonb`，没有必要。
4. **回填 ID 是确定性的 UUIDv7 形状**（`md5(tripId:ordinality)` + 强制 version=7、variant=8）。PG 17 没有 `uuidv7()`，若用 `gen_random_uuid()`（v4）会让迁移行在 `TripDestinationSchema`（UUIDv7）里解析失败 → 读取 500。
5. **旧 `destinations` 单项上限 120 → 160**：V2 名称允许 160（DB `VARCHAR(160)`），而 presenter 会把 V2 名称镜像进 deprecated 数组；不放大上限会让 121–160 字符的名称令整个 Trip 解析失败。旧数据（≤120）全部仍然合法。
6. **请求 `destinationsV2` 是真正的 `.optional()`**（键可省略，不是 `.nullable()` 伪装），已用契约测试锁定“老调用方不传该字段仍可创建/更新”。
7. **响应侧**：服务端 presenter **总是**返回 `destinationsV2`（空数组也算）；但 `TripSchema` 里该字段声明为 `.optional()`，`Trip` 的 TS 类型因此是可选。
   - 原因：`Trip` 同时在 `apps/web/test/fake-data.ts`、`apps/web/test/fixtures/trips.ts`、share/admin 测试夹具里被构造 / 解析，这些文件不在我的可写范围且正被并行 Agent 使用；把它设为必填会让这些共享夹具立刻编译失败（本轮并行约束下不可接受）。
   - 影响：运行时 API 响应永远有该键；类型层消费方需 `?? []`（已在新代码中处理）。
8. **输入 schema 额外接受 `country` / `countryCode`**（任务列出的输入字段没有这两项）：模型有这两列，如果输入不带就只能永远为 null，地址/国家无法回显。字段仍是 optional，不破坏兼容。
9. **V2 写入时旧 `destinations` 列镜像 names**：搜索（`destinations: { has }`）、admin/ai/share 等未改造消费方继续可用；旧读取方也能看到名字。
10. **迁移保留旧列**并用 `COMMENT ON COLUMN` 标记 DEPRECATED；未删除任何列/数据。

### 并行边界

只修改了任务允许的目录。**没有**改 `apps/web/components/{share,map,trip-workspace}/**`、`apps/admin/**`、`apps/api/src/modules/{media,share-links,ai,reports,settings}/**`。没有跑 `contracts:generate`。

---

## 3. 验证命令与结果（原始输出）

统一日志：`.audit/local-verify/destinations-verify.log`；E2E 原始输出：`.audit/local-verify/dest-e2e-output.txt`、`destinations-e2e-run.txt`。

### 3.0 Prisma 客户端重新生成

```
$ pnpm --filter @roamlog/db exec prisma generate
✔ Generated Prisma Client (7.10.1) to .\src\generated\prisma in 803ms
```

### 3.1 `pnpm --filter @roamlog/db test`（真实 PG：`postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=dest`）

```
$ prisma validate && vitest run
The schema at prisma\schema.prisma is valid 🚀
 ✓ src/__tests__/migration.0010.integration.test.ts (5 tests)
   ✓ 0010_trip_destinations against PostgreSQL (5)
     ✓ applies the whole migration series to an empty database
     ✓ backfills every existing name with its order and keeps the deprecated column
     ✓ rejects rows outside the contract with the named CHECKs
     ✓ enforces one active position per trip while allowing reused positions
     ✓ cascades rows when a trip is hard-deleted
 Test Files  19 passed (19)
      Tests  90 passed (90)
```

说明：`dest` schema 已先执行 `prisma migrate deploy`（0001→0010）以运行 seed 集成测试；0010 自己另建 `dest_dest_empty` / `dest_dest_data` 两个一次性 schema。

`pnpm --filter @roamlog/db typecheck` → `$ tsc --noEmit`（exit 0）。

### 3.2 `pnpm --filter @roamlog/api typecheck` + `exec vitest run src/modules/trips`

```
$ tsc --noEmit
EXIT=0

 ✓ src/modules/trips/__tests__/trips-destinations.spec.ts (11 tests)
 ✓ src/modules/trips/__tests__/stops-address.spec.ts (12 tests)
 ✓ src/modules/trips/__tests__/trips-origin-location.spec.ts (8 tests)
 ✓ src/modules/trips/__tests__/content-presenters.spec.ts (8 tests)
 Test Files  5 passed (5)
      Tests  48 passed (48)
```

### 3.3 `pnpm --filter @roamlog/contracts test`

```
 ✓ src/__tests__/trips.test.ts (8 tests)
 ✓ src/__tests__/entities.test.ts (31 tests)
 ✓ src/__tests__/openapi.test.ts (10 tests)
 Test Files  13 passed (13)
      Tests  117 passed (117)
```

### 3.4 `pnpm --filter @roamlog/web typecheck` + `exec vitest run components/trips/trip-form`

```
$ next typegen && tsc --noEmit
✓ Types generated successfully
EXIT=0

 ✓ components/trips/trip-form/__tests__/trip-form.test.tsx (13 tests)
     ✓ TripForm structured destinations (4)
       ✓ submits a searched destination with its address, coordinates and timezone
       ✓ echoes stored destination metadata on edit without rewriting it
       ✓ submits the new order after moving a destination
       ✓ shows a names-only legacy trip and upgrades a row through search
 Test Files  5 passed (5)
      Tests  52 passed (52)
```

### 3.5 `pnpm --filter @roamlog/web build`

```
✓ Generating static pages (10/10)
Route (app) ...
├ ƒ /w/[workspaceSlug]/trips
├ ƒ /w/[workspaceSlug]/trips/[tripId]/edit
├ ƒ /w/[workspaceSlug]/trips/new
EXIT=0
```

### 3.6 端到端（独立端口 4270 + 独立 schema `dest_e2e`）

脚本：`bash .audit/local-verify/destinations-e2e.sh`（`prisma migrate deploy` → 种子 owner/workspace → 起真实 API `:4270` → `node destinations-e2e.mjs`）。未使用 4000 端口，未触碰 `public`/`dest` schema。

关键原始输出（摘自 `dest-e2e-output.txt`，测试数据已脱敏）：

```
--- POST /v1/auth/sign-in/email ---
{ "status": 200, "user": { "id": "01a1…", "email": "dest-e2e@roamlog.test" } }
PASS  sign-in returns 200 with a session cookie

--- POST /v1/workspaces/:workspaceId/trips ---
{ "status": 201, "body": {
  "title": "关西慢行", ...,
  "destinations": ["京都", "大阪"],
  "destinationsV2": [
    { "name": "京都", "provider": "geoapify", "providerPlaceId": "51e1…",
      "address": "京都市, 京都府, 日本", "country": "日本", "countryCode": "JP",
      "lat": 35.0116, "lng": 135.7681, "timeZone": "Asia/Tokyo",
      "bbox": [135.6, 34.85, 135.93, 35.17], "order": 0 },
    { "name": "大阪", "provider": "photon", "address": "大阪市, 大阪府, 日本",
      "countryCode": "JP", "lat": 34.6937, "lng": 135.5023,
      "timeZone": "Asia/Tokyo", "order": 1 } ] } }
PASS  create with destinationsV2 returns 201
PASS  create response carries both destinations in order
PASS  create response also exposes the deprecated names array

--- GET /v1/trips/:tripId ---
PASS  read-back returns 200
PASS  read-back keeps order, address, coordinates, bbox and timezone

--- PATCH /v1/trips/:tripId (3 destinations) ---
{ "status": 200, "destinationsV2": ["京都","大阪","奈良"], "version": 2 }
PASS  replacing the group keeps three active rows

--- PATCH /v1/trips/:tripId (replace with 1) ---
{ "status": 200, "destinationsV2": ["大阪"], "version": 3 }
PASS  replacement leaves exactly one active destination
PASS  the remaining destination keeps its place metadata

--- GET after replacement ---
{ "status": 200, "destinationsV2": [{"name":"大阪","order":0}], "destinations": ["大阪"] }
PASS  GET after replacement shows only the new row

--- POST legacy trip (destinations only) ---
{ "status": 201, "body": { "destinations": ["东京"], "destinationsV2": [] } }
PASS  legacy create returns 201 with the names array
PASS  legacy create returns an empty structured group instead of inventing rows

--- GET legacy trip ---
{ "status": 200, "destinations": ["东京"], "destinationsV2": [] }
PASS  legacy trip remains readable after the upgrade

ALL E2E CHECKS PASSED
```

（软删只能通过 `GET` 只剩 1 条间接证明；数据库层的 `deletedAt` 语义由 `migration.0010` 的 partial-unique 用例直接证明。）

---

## 4. CodeGraph 证据

1. `codegraph_explore`（MCP，projectPath=`C:\Users\BY9700\Desktop\UI\roamlog`）：
   - 查询：`Trip model destinations TripDestination originLat presenter TripPresenter`
   - 关键结果：定位 `apps/api/src/modules/trips/content-presenters.ts`（`presentTrip` / `PresentTripInput`）、`trips.service.ts`、`trips.repository.ts`、`packages/contracts/src/entities/trip.ts`、`apps/web/components/trips/trip-form/destinations-field.tsx`；blast radius 显示 `presentTrip` 有 12 个调用方（trips/media/admin），`findTrip` 15 个调用方（media/itinerary/expenses 等）——据此确认“加 include + presenter 显式构造不影响其它模块”。
2. `codegraph_explore`（MCP）：
   - 查询：`destinationsV2 TripDestination replaceDestinations presentTrip destinationsFromTrip`
   - 关键结果：`replaceDestinations` 1 个调用方（`TripsService.update`），测试命中 `trips-destinations.spec.ts`；`presentTrip` 12 调用方；`TripDestination` 4 调用方（form-state、factories）；`packages/api-client/src/generated/schemas/tripDestinationsV2Item.ts` 已出现（父 Agent 的 `contracts:generate` 影响，属预期）。
3. `codegraph status`：索引 up to date（1,732 files / 27,025 nodes，watcher 自动增量同步）。

---

## 5. 是否需要重生成契约

**是。** 我按要求**没有**运行 `contracts:generate`。需要重生成的产物：

- `packages/contracts/openapi.json`
- `packages/api-client/src/generated/**`（`Trip.destinationsV2`、`TripDestinationInput`、`Create/UpdateTripRequest.destinationsV2`）

父 Agent 已在我半成品状态下跑过一次生成；最新 schema 还需再生成一次。生成后建议补一条 `contracts:check`。

---

## 6. `destinations` 消费方清单（我未修改）

以下位置仍消费旧 `destinations`（names 数组）；由于 presenter 从 V2 派生并使用旧列镜像，它们**不会坏**，但还没用上坐标/地址：

| 位置 | 用途 |
| --- | --- |
| `apps/api/src/modules/share-links/share-links.service.ts:236` | 公开页 `trip.destinations`（未改造，V2 不暴露到公开契约） |
| `apps/api/src/modules/search/search.repository.ts:17,61,70` | 搜索仍 `has` 旧列 + select 旧列 |
| `apps/api/src/modules/search/search.service.ts:64` | 搜索结果摘要拼接目的地名 |
| `apps/api/src/modules/ai/ai-tools.ts:82,157,413,456` | AI 提示/工具参数用 names |
| `apps/api/src/modules/admin/admin-selects.ts:45` | Admin 列表 select 旧列 |
| `apps/api/src/modules/admin/admin-content.service.ts`（经 `presentTrip`） | 读取会拿到 V2，但未展示 |
| `apps/web/components/trips/trip-card.tsx:60,86` | 卡片路线文字/站数 |
| `apps/web/components/trips/trip-detail-overview.tsx:33,67-71` | 详情页路线时间线 |
| `apps/web/components/trips/trips-library.tsx:96` | 列表本地搜索 |
| `apps/web/components/trip-workspace/**`（禁止区） | `TripSchema.parse` 消费 Trip |
| `apps/web/components/share/**`（禁止区） | 公开分享页（`PublicTrip`，不含 V2） |
| `apps/web/test/{fake-data.ts,fixtures/trips.ts}` | 测试夹具，仅旧 names |
| `packages/api-client/src/generated/**` | 生成物，需重生成 |

另：`apps/api/src/modules/{media,reports}/**` 的测试夹具仍构造 `destinations: [...]`（Trip record），因为字段保留且 presenter 可回退，未受影响。

---

## 7. 已知风险

1. **响应契约类型层可选**：`Trip.destinationsV2` 在 `TripSchema` 是 optional（运行时必返回）。忘记 `?? []` 的 TS 消费方会拿到 `undefined`；不改共享夹具是并行约束下的取舍（见 2.7）。
2. **旧客户端 PATCH 语义**：若一个只认识旧 `destinations` 的客户端 PATCH 旧的 names 数组，而该 trip 已有 V2 行，则 V2 行按任务要求“不动”，presenter 以 V2 为准 → 旧客户端的这次目的地修改在读取时不可见。当前 Web 表单总是发 V2；此风险只影响历史客户端/手工调用。
3. **`country` 精度**：Geoapify/Photon 的 `country` 最长为 120，契约/DB 一致；`address` 上限 400（Provider 给 500 的契约，但目的地列按任务要求 400）。超长地址会被 422 拒绝（不是静默截断）。
4. **迁移 UUID 形状**：回填 ID 是 md5 派生的 v7 形状（非时间有序），只影响排序稳定性（presenter 先按 order 排序），不影响契约。
5. **启动环境**：E2E 首轮 API 启动曾因并行 Agent 正在改的 `modules/media/media-url.service.ts` 瞬时缺 import 失败（`PinoLoggerService is not defined`）；该文件随后由对方修好，重试通过。不是本任务代码。另 API 在本机 S3/Redis 不可达时启动较慢（degraded，约 60s），E2E 已加超时与等待。
6. **Web build 与并行改动**：build 通过的快照包含其它 Agent 的未提交改动（share/share-article、media 等），如果他们继续修改可能再次变红，与本任务无关。

---

## 8. 未覆盖项（明确）

- **拖拽排序**：按任务说明只做上/下移按钮，没有引入拖拽库（`@dnd-kit` 等）——即“简单上下按钮即可”已覆盖。
- **地图渲染 / trip-workspace / share 页面使用 V2**：属禁止区，未改。地图目前仍拿不到新坐标（`Trip.destinationsV2` 已在 API 响应里，下一步由对应 Agent 消费）。
- **目的地级更新/删除 API**（`PATCH /trips/:id/destinations/:destinationId`）：任务只要求整组替换，未新增独立端点。
- **公开分享页暴露结构化目的地**：未改 share-links 契约/服务（禁止区）。
- **`destinations` 旧列删除**：按任务保留，未删。
- **数据库层直接把回填行的 `provider` 标为来源**：旧数组没有来源信息，回填保持 `provider NULL`（UI 显示“仅名称”）；未猜测。
- **视觉截图/移动端实机检查**：未产出截图（本轮以单元/组件/接口测试与 build 为证据）；表单布局沿用既有 `FormRow`/`ol` 模式，仅增加元数据行与“搜索替换”按钮。
- **HTTP 层 duplicate/remove 的 E2E**：由 API 单测覆盖（复制行、级联软删），E2E 只覆盖任务要求的 4 条 HTTP 流程。

---

## 9. 提交与工作区状态

- 4 个本地 commit：`db` / `contracts` / `api` / `web`（web commit 含本报告 + E2E 脚本）。
- **未提交** `packages/contracts/src/__tests__/entities.test.ts`：该文件含 share-links Agent 未提交的 `PublicStop.provider` 改动；我只追加了 5 条实体测试，为避免把别人的改动混进我的 commit，留给父 Agent 一并处理。
- 未提交/未改动：`packages/contracts/openapi.json`、`packages/api-client/src/generated/**`、`apps/web/next-env.d.ts` 等其它 Agent 的在途改动。
- `.audit/local-verify/dest-e2e-api.log`、`dest-e2e-output.txt`、`destinations-e2e-run.txt` 为运行日志（不含密钥；cookie 在 `.data/dest-e2e/`）。

---

## 10. 建议下一步

1. 父 Agent 重跑 `pnpm contracts:generate` + `pnpm contracts:check`，提交生成物。
2. 由 web/map 负责人把 `trip-card` / `trip-detail-overview` / `trips-library` / 地图页切到 `destinationsV2`（坐标、地址、时区已就绪）。
3. share-links 负责人决定公开页是否暴露 V2（需要契约变更，不能偷偷加字段）。
4. 观察一个版本后删除旧 `destinations` 列（先切搜索 `has` 到 V2 join，再删）。
5. 若要让旧客户端 PATCH 旧 names 也生效，可在“未传 V2 但传了旧 names”时把 names 同步成 name-only V2 行（本轮按任务要求保持“不动”）。