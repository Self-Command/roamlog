# F7_STOP_PROVIDER — Geoapify 选中地点无法落库的修复报告

状态: DONE
任务 ID: `F7_STOP_PROVIDER`
角色: data_worker + backend_api（含 `trip-form` Web 接线）
时间: 2026-11-19（Asia/Shanghai）
提交: `0fda21e`（contracts+db）/ `760839a`（api）/ 第 3 次提交（web + 本报告）

## 1. 问题与结论

`.audit/f-address-report.md` 的实测结论是：`PlaceProviderSchema` 与 `Stop_provider_check`
只允许 `photon|local`，而地点搜索在 C 之后默认返回 Geoapify 结果。结果是**选中的地点能搜到，
但写 `Stop` 时被 `23514` 拒绝**——这是功能级断裂，不是展示问题。

本次修复把「搜索来源」与「可存储来源」重新对齐：

- 契约 `PlaceProviderSchema` → `geoapify | photon | local`；
- 新增迁移 `0007_stop_provider_geoapify`，只替换 CHECK 约束，不改列、不重写数据；
- API 的 stop 创建/更新链路本来就会落 `provider/providerPlaceId/address/bbox`，本任务补齐
  对 `geoapify` 的接受，并把非法 provider 从通用 400 提升为字段级 `422 INVALID_PROVIDER`；
- AI 工具 `stops.add` 原来只写 `city/country/lat/lng/provider/providerPlaceId/timeZone`，
  现在从本 run 的 `places.search` 候选里带出 `provider/providerPlaceId/address/bbox/timeZone`
  一并写入；
- Web 的 `trip-form` 在选中地点时取 `Place.provider`（不再依赖字面量），并锁定「Trip 提交
  不带 provider」这一现状。

端到端已在隔离 API `:4210` + 隔离 schema `f7_e2e` 上验证：`provider:"geoapify"` 创建返回
201，独立 GET 回读 `provider/address/bbox` 全在；`provider:"unknown"` 返回 422。

## 2. 变更文件

### 提交 1 — `0fda21e feat(contracts,db): allow geoapify as a stored stop provider`

契约：

- `packages/contracts/src/entities/stop.ts`
  - `PlaceProviderSchema = z.enum(["geoapify", "photon", "local"])`。
  - `CreateStopRequestSchema` / `UpdateStopRequestSchema` 引用同一个 schema，自动生效（已用
    契约测试断言 create/update 均接受 `geoapify`、拒绝未知值）。
- `packages/contracts/src/api/places.ts`
  - 删除「Stop 仍是 photon|local，所以两个枚举故意分开」的过期注释，改为「两个枚举分开定义
    但取值集合必须一致，`entities.test.ts` 防漂移」。
- `packages/contracts/src/__tests__/entities.test.ts`
  - 新增：`geoapify` 通过、`mapbox` 拒绝；`Create/UpdateStopRequest` 的 provider 行为；
  - 新增：`PlaceProviderSchema.options` 与 `PlaceSearchProviderSchema.options` 的集合一致性断言。

DB：

- `packages/db/prisma/migrations/0007_stop_provider_geoapify/migration.sql`（新增）
  - `ALTER TABLE "Stop" DROP CONSTRAINT "Stop_provider_check";`
  - `ADD CONSTRAINT "Stop_provider_check" CHECK ("provider" IS NULL OR "provider" IN ('geoapify','photon','local'))`
  - 纯约束变更：无 ADD/DROP COLUMN、无 ALTER COLUMN、无 DML、无索引、无 `NOT VALID`。
  - `schema.prisma` 不需要改：`Stop.provider` 本来就是 `String?`，约束只在迁移里。
- `packages/db/src/__tests__/migration.0007.test.ts`（新增，静态契约）
  - 迁移全序；DROP 在 ADD 之前且各出现一次；约束名保持；无列/类型/数据变更。
- `packages/db/src/__tests__/provider-geoapify.integration.test.ts`（新增，真实 PG）
  - 空库全序 0001–0007；`pg_get_constraintdef` 含三个来源；
  - 0001–0006 + `provider='photon'` 旧行 → 0007 后旧行（含 address/bbox）逐字段不变；
  - 旧行改 `geoapify` 成功；新插 `geoapify` stop 成功；
  - update / insert `unknown` 均 `23514` 且 constraint = `Stop_provider_check`。
- `packages/db/src/__tests__/migration.0004.test.ts`、`migration.0005.test.ts`、`migration.0006.test.ts`
  - 仅把 0007 追加进「迁移全序」期望列表（与 0006 当时的做法一致）。

### 提交 2 — `760839a feat(api): persist provider, address and bbox when AI adds a stop`

- `apps/api/src/modules/trips/content-values.ts`
  - 新增 `assertRawProvider(rawInput, field)`：在 `parseRequest` 之前用
    `PlaceProviderSchema.nullable()` 校验原始 body；缺失键放行（update 不改），`null` 放行
    （清空）；非法值 → `422 INVALID_PROVIDER`（镜像既有 `assertRawBbox` 的 422 处理）。
  - **为什么需要**：本 API 的通用 Zod 解析映射是 400；provider 是「合同枚举不承认的业务
    取值」，按任务要求应为 422，故像 bbox 一样在 schema 前拦一次。
- `apps/api/src/modules/trips/stops.service.ts`
  - `create` / `update` 均先 `assertRawProvider(rawInput, "provider")`。
  - `provider/providerPlaceId/address/bbox/timeZone` 的落库逻辑 F 已加好，本任务只放开来源。
- `apps/api/src/modules/trips/__tests__/stops-address.spec.ts`
  - 新增 5 条：create `geoapify` 写入并回读；update `geoapify`；create `unknown` → 422 且不落库；
    update `unknown` → 422；显式 `null` 清空 vs 省略不改。
- `apps/api/src/modules/ai/ai-tools.ts`
  - `AiPlaceCandidate` 增加 `address: string | null`、`bbox: Place["bbox"]`；`provider` 类型改为
    `Place["provider"]`（不再人为降级）。
  - `toCandidate` 逐字段透传 `provider/address/bbox`（删除「geoapify 存成 null」的旧逻辑）。
  - `addStop` 写入 `address`、`bbox`，`provider/providerPlaceId/timeZone` 继续取候选。
  - `storableStopAddress()`：`Place.address` 允许 500，`Stop.address` 契约/列是 400；超长时
    降级为 `null` 而不是让整条 stop 写入失败（满足「取不到/存不下的字段留 null」）。
  - **未改** `ai-plan.service.ts` / `ai-execute.service.ts` / 工具参数与校验逻辑；`placeRef`
    在代码中的实际参数名是 `providerPlaceId`，候选集合校验（E1）保持不变，`addStop` 内仍
    二次校验 `context.candidates.get(providerPlaceId)`。
- `apps/api/src/modules/ai/__tests__/ai-fixtures.ts`
  - `KINKAKUJI` 补 address/bbox；新增 Geoapify 候选 `GEOAPIFY_KYOTO`；
    `placeSearchItems(candidate)` 透传 source/address/bbox。
- `apps/api/src/modules/ai/__tests__/ai-stops-add.spec.ts`（新增）
  - 真实 `AiToolbox` + 真实 `StopsService`（桩 places.search + 记录型 StopsRepository）：
    `places.search` → 候选保留 `provider:"geoapify"`/address/bbox；`stops.add` → 仓库收到的
    写入数据带 `provider/address/bbox/timeZone`；返回 stop 的 presenter 结果同样带这些值。
  - 第二例：未在本 run 搜索过的 `providerPlaceId` 仍返回 `UNRESOLVED_PLACE`，不写库。

### 提交 3 — `feat(web): take the trip form origin provider from the picked place`（含本报告）

- `apps/web/components/trips/trip-form/trip-form-state.ts`
  - 新增 `originFromPlace(place)`：`provider` 取自 `Place.provider`，同时带出 address/bbox；
  - `valuesFromTrip` 的编辑回填仍是 `photon|local` 的**展示推断**（`Trip` 没有 origin provider
    列，按任务要求不新增字段），加注释说明它只驱动「地点库/手动地点」徽标、不参与提交。
- `apps/web/components/trips/trip-form/trip-form.tsx`
  - `handleOriginSelect` 改用 `originFromPlace(place)`；选中 Geoapify 结果时表单态 provider
    就是 `"geoapify"`（手动输入仍为 `"local"`）。
  - `destinations-field` / `destinations` 未改：目的地仍只存 `string[]`，提交不带 provider。
- `apps/web/components/trips/trip-form/__tests__/trip-form-state.test.tsx`
  - 新增：`originFromPlace(Geoapify Place)` 的 provider/geodata；create payload 带
    originAddress/originBbox/timeZone，且**不含** `provider`/`originProvider`。
- `.audit/f7-report.md`（本文件）。

## 3. 实现摘要（逐 5 项）

1. **契约**：`PlaceProviderSchema` 加 `geoapify`；Create/Update Stop 请求自动继承；新增
   「可存储来源集合 == 搜索来源集合」防漂移断言。
2. **迁移**：`0007_stop_provider_geoapify` 只替换 `Stop_provider_check`；空库全序、旧数据保留、
   `geoapify` 写入成功、`unknown` 仍 23514，全部在真实 PG 上验证。
3. **API**：`StopsService.create/update` 接受并落 `provider(geoapify)/providerPlaceId/address/bbox`；
   非法 provider → `422 INVALID_PROVIDER`；Trip 侧未新增字段、未受影响；AI `stops.add` 从候选
   写入 provider/address/bbox/timeZone；公开分享仍只透出 `address`，不公开 provider/bbox。
4. **Web**：起点选中结果取 `Place.provider`（Geoapify → `"geoapify"`）；目的地维持 `string[]`，
   payload 不带 provider（有测试锁定）；`Trip` 没有 origin provider 字段，编辑页回填仅用于徽标。
5. **测试**：契约 2 条新增；迁移静态 3 条 + 真实 PG 3 条 + 3 个旧迁移全序更新；API 5 条新增；
   AI 2 条新增；Web 2 条新增。

## 4. 验证命令与原始输出

### 4.1 DB（真实 PG，schema `f7`）：`pnpm --filter @roamlog/db test`

```bash
$ ROAMLOG_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=f7" \
  pnpm --filter @roamlog/db test
$ prisma validate && vitest run
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/packages/db

 ✓ src/__tests__/schema.test.ts (9 tests)
 ✓ src/__tests__/settings-defaults.test.ts (4 tests)
 ✓ src/__tests__/migration.0004.test.ts (5 tests)
 ✓ src/__tests__/settings-defaults.test.ts
 ✓ src/__tests__/migration.0007.test.ts (3 tests)
 ✓ src/__tests__/client.test.ts (2 tests)
 ✓ src/__tests__/migration.w0.test.ts (11 tests)
 ✓ src/__tests__/seed.test.ts (9 tests)
 ✓ src/__tests__/system-setting.integration.test.ts (7 tests)
 ✓ src/__tests__/provider-geoapify.integration.test.ts (3 tests)
   ✓ 0007_stop_provider_geoapify against PostgreSQL (3)
     ✓ applies the whole migration series to an empty database 562ms
     ✓ keeps pre-0007 rows unchanged and then accepts geoapify 573ms
 ✓ src/__tests__/seed.integration.test.ts (1 test)
 ✓ src/__tests__/address-bbox.integration.test.ts (4 tests)
 ✓ src/__tests__/platform-role-override.integration.test.ts (3 tests)

 Test Files  14 passed (14)
      Tests  70 passed (70)
   Duration  2.44s
```

（迁移 0007 也已通过 `prisma migrate deploy` 应用到 `schema=f7`，输出含
`Applying migration \`0007_stop_provider_geoapify\`` 与 `All migrations have been successfully applied.`。）

### 4.2 API 类型与测试

```bash
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
[exit code: 0]

$ pnpm --filter @roamlog/api exec vitest run src/modules/stops src/modules/ai src/modules/trips
 ✓ src/modules/ai/__tests__/ai.controller.spec.ts (6 tests)
 ✓ src/modules/ai/__tests__/ai-plan.service.spec.ts (11 tests)
 ✓ src/modules/ai/__tests__/ai-execute.service.spec.ts (8 tests)
 ✓ src/modules/trips/__tests__/trips-origin-address.spec.ts (9 tests)
 ✓ src/modules/trips/__tests__/stops-address.spec.ts (12 tests)
 ✓ src/modules/trips/__tests__/trips-origin-location.spec.ts (8 tests)
 ✓ src/modules/ai/__tests__/ai-stops-add.spec.ts (2 tests)
 ✓ src/modules/trips/__tests__/content-presenters.spec.ts (8 tests)
 ✓ src/modules/ai/__tests__/golden.spec.ts (3 tests)
 ✓ src/modules/ai/__tests__/adapters.integration.spec.ts (7 tests | 6 skipped)

 Test Files  10 passed (10)
      Tests  68 passed | 6 skipped (74)
```

注：`apps/api/src/modules/stops` 目录不存在（stops 在 `modules/trips` 下），vitest 把它当作
无匹配过滤器忽略，不产生失败；上面是原命令的原始结果。

### 4.3 契约：`pnpm --filter @roamlog/contracts test`

```bash
 ✓ src/__tests__/permissions.test.ts (10 tests)
 ✓ src/__tests__/admin-settings.test.ts (7 tests)
 ✓ src/__tests__/money.test.ts (4 tests)
 ✓ src/__tests__/ai.test.ts (7 tests)
 ✓ src/__tests__/pagination.test.ts (7 tests)
 ✓ src/__tests__/realtime.test.ts (3 tests)
 ✓ src/__tests__/admin.test.ts (4 tests)
 ✓ src/__tests__/entities.test.ts (26 tests)
 ✓ src/__tests__/openapi.test.ts (10 tests)

 Test Files  9 passed (9)
      Tests  78 passed (78)
```

### 4.4 Web

`pnpm --filter @roamlog/web exec vitest run components/trips/trip-form`：

```bash
 ✓ components/trips/trip-form/__tests__/trip-form.test.tsx (9 tests) 2531ms
 ✓ components/trips/trip-form/__tests__/trip-form-state.test.tsx (...)
 Test Files  4 passed (4)
      Tests  41 passed (41)
```

`pnpm --filter @roamlog/web typecheck` — **当前会被过期的生成物卡住**（不是本次源码错误）：

```bash
$ pnpm --filter @roamlog/web typecheck
components/trip-workspace/stops-tab.tsx(213,78): error TS2322: Type '{ ... provider?: "local" | "geoapify" | "photon" | null ... }' is not assignable to type 'UpdateStopRequest'.
  Types of property 'provider' are incompatible.
    Type '"geoapify"' is not assignable to type 'UpdateStopRequestProvider | undefined'.
components/trip-workspace/stops-tab.tsx(224,13): error TS2322: ... same stale 'UpdateStopRequestProvider'
components/trip-workspace/stops-tab.tsx(244,65): error TS2322: ... same stale 'CreateStopRequestProvider'
[ELIFECYCLE] Command failed with exit code 2.
```

根因：`packages/api-client/src/generated/schemas/{create,update}StopRequestProvider.ts` 仍是
`photon|local`；本任务**被明确禁止**运行 `contracts:generate`（根 Agent 串行执行）。

为了证明「除了生成物以外没有其它类型错误」，我在本地临时给 6 个生成的 provider 枚举补了
`geoapify`，重跑：

```bash
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
[exit code: 0]
```

随后立即用 `git show HEAD:<file>` 还原这 6 个生成文件，`git status packages/api-client` 为空。
**正式交付仍需根 Agent 串行执行 `pnpm contracts:generate` + `pnpm api-client:generate` 后再跑一次 web typecheck。**

### 4.5 端到端（隔离 API `:4210` + 隔离 PG `schema=f7_e2e`）

准备：`prisma migrate deploy` 全序到 0007；一次性脚本向隔离 schema 写入已验证用户 +
owner workspace + trip（临时文件已删除，schema 已 DROP）。API 以
`API_PORT=4210 DATABASE_URL=...?schema=f7_e2e` 启动（Redis 不可用，服务 fail-open）。

```text
=== 0) POST /v1/auth/sign-in/email ===
status=200

=== 1) POST /v1/trips/<tripId>/stops  provider=geoapify ===
{"id":"01a1f27e-55dc-730b-8027-2556fa5eb4c5","tripId":"0199f070-0000-7000-8000-000000000005","city":"京都","country":"日本","countryCode":"JP","lat":35.0115754,"lng":135.7681441,"provider":"geoapify","providerPlaceId":"51e1bdfea47461405994da8b683bb64140f00103f9","timeZone":"Asia/Tokyo","address":"京都市, 京都府, 日本","bbox":[135.6081441,34.8515754,135.9281441,35.1715754],"startDate":"2027-03-01","endDate":"2027-03-02","notes":"F7 provider e2e","order":0,"version":1,"createdAt":"2026-11-19T06:28:48.220Z","updatedAt":"2026-11-19T06:28:48.220Z","deletedAt":null}
status=201

=== 2) GET /v1/trips/<tripId>/stops (independent read-back) ===
[{"id":"01a1f27e-...","provider":"geoapify","providerPlaceId":"51e1bdfea47461405994da8b683bb64140f00103f9","timeZone":"Asia/Tokyo","address":"京都市, 京都府, 日本","bbox":[135.6081441,34.8515754,135.9281441,35.1715754],...}]
status=200

=== 3) POST stop provider=unknown (must be 422) ===
{"type":"https://roamlog.app/errors/invalid-provider","title":"Unprocessable Content","status":422,"detail":"provider must be one of geoapify, photon, local or null.","code":"INVALID_PROVIDER","errors":[{"field":"provider","code":"INVALID_PROVIDER","message":"Invalid option: expected one of \"geoapify\"|\"photon\"|\"local\""}]}
status=422
```

（均为本地一次性测试账号/ID，无真实用户数据；cookie 只在临时目录，已删除。）

## 5. CodeGraph 证据

```text
$ codegraph status
Project: C:\Users\BY9700\Desktop\UI\roamlog
Files: 1,616 / Nodes: 24,881 / Edges: 55,508   [OK] Index is up to date
```

`codegraph_explore("PlaceProviderSchema StopsService create assertRawProvider AiToolbox addStop toCandidate")`
返回的关键事实：

- 调用链：`AiToolbox.addStop` (`apps/api/src/modules/ai/ai-tools.ts:470`) → `StopsService.create`
  (`.../stops.service.ts:51`) → `assertRawProvider` (`.../content-values.ts:204`)；
- `assertRawProvider`：3 个调用方（stops.service 的 create/update 等），被
  `stops-address.spec.ts` / `content-stops.e2e-spec.ts` 覆盖；
- `StopsService` 11 个调用方（`ai-tools.ts`、`trips.controller.ts`、`trips.module.ts`），
  测试 `ai-stops-add.spec.ts`、`stops-address.spec.ts`、`content-stops.e2e-spec.ts`；
- `AiToolbox` 16 个调用方（`ai-execute.service.ts`、`ai-plan.service.ts`、`ai.module.ts`），
  blast radius 覆盖 AI 计划/执行与金样测试；
- `toCandidate` 唯一调用方是 `searchPlaces`，新增的 address/bbox 透传不影响其它工具。

## 6. 已知风险

1. **生成物暂时滞后**：`packages/api-client` 的 provider 枚举、`packages/contracts/openapi.json`
   仍是旧值；在根 Agent 串行执行 `contracts:generate` + `api-client:generate` 之前，
   `@roamlog/web typecheck` 会报上述 3 条（已证明与源码无关）。旧 OpenAPI 也可能让
   `contracts:check` 失败。
2. **Web 的 provider 展示缺口（越界未改）**：`apps/web/components/trip-workspace/format.ts`
   的 `providerLabel()` 只处理 `photon`/`local`，`geoapify` 会落到 default「手动录入」。
   该文件不在本任务允许范围，未修改；建议由 trip-workspace 的负责人补一个 `geoapify` 分支
   （例如显示「Geoapify」）。
3. **Trip 起点没有 provider 持久化**：按任务要求不新增字段，所以编辑页无法知道起点当时来自
   Geoapify 还是 Photon；`valuesFromTrip` 用「有坐标 → photon」仅做徽标展示，且不参与提交。
   这是现状，不是本次引入。
4. **AI 超长地址降级**：`Place.address` 允许 500 字，`Stop.address` 只允许 400；AI 写入时
   401–500 字的地址会被置 `null`（其余元数据仍写入），属于有意的可用性取舍。
5. **`assertRawProvider` 改变错误码语义**：非法 provider 从原来的 400 `VALIDATION_ERROR`
   变为 422 `INVALID_PROVIDER`；这是任务要求，且与 bbox 的既有模式一致，但调用方若曾断言
   400 需同步（仓库内未发现此类断言）。

## 7. 未覆盖项

- 未新增 `apps/api/test/**` HTTP e2e spec（该目录不在允许修改范围）；本节 4.5 的 curl 端到端
  是一次性手工验证，未固化为自动化用例。
- AI 测试用真实 `AiToolbox` + 真实 `StopsService` + 桩 places/仓库，未连 PostgreSQL；数据库
  写入路径由 DB 集成测试与 4.5 的 API e2e 覆盖。
- 未运行 `contracts:generate` / `api-client:generate`（按任务由根 Agent 串行执行）。
- 未改 `apps/web/components/trip-workspace/**`（providerLabel 缺口见风险 2）。
- 目的地仍不带 provider/address：本任务明确保持 `string[]`，未改结构。

## 8. 建议下一步

1. 根 Agent 串行执行 `pnpm contracts:generate` + `pnpm api-client:generate`，提交生成物，
   再跑 `pnpm --filter @roamlog/web typecheck` 与 `contracts:check`，确认全绿。
2. 给 `providerLabel()` 补 `geoapify` 分支（trip-workspace 负责人），避免 Geoapify stop 显示
   「手动录入」。
3. 若产品需要，后续任务把目的地升级为带 provider/address/bbox 的结构（会改 Trip 契约与
   数据库，属独立切片）。
4. 把 4.5 的 curl 场景固化成 `apps/api/test/stop-provider.e2e-spec.ts`（需要 `apps/api/test/**`
   写权限）。
5. 如希望 AI 保留超长地址，可在 `Stop.address` 契约/列上评估扩到 500（需要迁移），否则维持
   当前的截断降级策略。