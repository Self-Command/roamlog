# API Mocks 契约修复 —— PASS

时间: 2026-11-19 15:02
任务 ID: `FIX_API_MOCKS_FIXTURES`
角色: qa_verifier
基线: `main@4547b00`（工作树含其它 Agent 的并行改动；本任务只改 `packages/api-mocks/**`）
提交: `test(api-mocks): keep the shared fixtures valid for the new stop and trip fields`

## 状态

**DONE**：`@roamlog/api-mocks` 单元测试 5/5 通过，typecheck 通过，import 阶段不再抛；Playwright `--list` 可加载全部 58 个用例 / 19 个 spec 文件（此前 api-mocks import 崩溃会让整份 e2e 列表加载失败）。

## 变更文件

| 文件 | 变更 |
|---|---|
| `packages/api-mocks/src/fixture-defaults.ts` | `tripDefaults` 补 `originAddress: null`、`originBbox: null`（9 条 trip 共用） |
| `packages/api-mocks/src/demo-content.ts` | `demoStops` 构造补必填可空键 `address: null`、`bbox: null`（10 条 stop） |
| `packages/api-mocks/src/__tests__/fixtures.test.ts` | 新增深路径导出断言、非空 address/bbox 解析断言，并补 `ItineraryItemSchema` 逐项校验 |

## 实现摘要（逐 4 项）

1. **构造点盘点**：`rg -n "StopSchema.parse|TripSchema.parse|: Stop\b|: Trip\b|satisfies Stop|satisfies Trip" packages/api-mocks/src` 命中 3 个构造点——`fixtures.ts:276`（`demoTrips`，`TripSchema.array().parse`）、`demo-content.ts:588-589`（`demoStops`，`StopSchema.parse`），以及本次新增的两个测试构造点（`fixtures.test.ts:72/80`）。`handlers.ts` 只消费已解析的 fixtures，不直接构造 `Stop`/`Trip`。
2. **补齐必填可空键**：trip 侧在 `tripDefaults` 加 `originAddress: null` / `originBbox: null`，9 条 trip 全部继承；stop 侧在 `demoStops` 的 parse 字面量里显式写 `address: null` / `bbox: null`。没有放宽 schema、没有 `as any`、没有改 `packages/contracts`。
3. **其它集合对照**：`git diff 32efb41..HEAD -- packages/contracts/src/entities` 显示冻结以来实体契约只改了 `audit-log.ts` / `stop.ts` / `trip.ts`，`MediaSchema`、`JournalEntrySchema` 未变；api-mocks 中 grep `Public` 为空，未构造 `PublicStop`/`PublicTrip`（它们只在 `packages/contracts/src/api/share-links.ts`）。测试现在逐项 `safeParse` 校验 members / invitations / entries / media / itinerary / stops / expenses / packing / comments / activities / notifications，并沿用 `MeResponseSchema` / `MyWorkspacesResponseSchema`。额外用 tsx 冒烟 import `handlers.ts`（19 个 handler，无抛错），确认 `EntryPageSchema` 等分页响应也未因契约漂移而崩。
4. **e2e 深路径证明**：`e2e/support/mock-fixtures.ts` 通过 `../../packages/api-mocks/src/fixtures` 取 `demoTrips`。新增测试 `keeps the deep-path exports used by e2e/support/mock-fixtures.ts parseable` 断言 `demoTrips`/`demoStops` 非空、`demoStops` 与 `demoFixtureState.stops` 同源，并重新通过 `TripSchema.array()` / `StopSchema.array()` 解析；另用 tsx 直接执行该 e2e support 模块，输出 `MOCK_TRIP_COUNT=9`。新增测试 `accepts populated place address and bbox fields on stops and trips` 证明非空 `address`/`bbox`/`originAddress`/`originBbox` 也能通过契约（防止“只支持 null”的假绿）。

## 验证命令与结果

### 修复前（复现根因）

```
$ pnpm --filter @roamlog/api-mocks test
...
"path": ["address"], "message": "Invalid input: expected string, received undefined"
"path": ["bbox"], "message": "Invalid input: expected tuple, received undefined"
 ❯ src/demo-content.ts:589:14
 Test Files  1 failed (1)
      Tests  no tests
```

### 1) 单元测试

```
$ pnpm --filter @roamlog/api-mocks test
$ vitest run

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/packages/api-mocks

 ✓ src/__tests__/fixtures.test.ts (5 tests) 17ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  15:00:44
   Duration  539ms
```

### 2) 类型检查

```
$ pnpm --filter @roamlog/api-mocks typecheck
$ tsc --noEmit
[exit code: 0]
```

### 3) import 冒烟（tsx）

```
$ pnpm exec tsx -e "import { demoTrips, demoStops } from './packages/api-mocks/src/fixtures.ts'; console.log('demoTrips =', demoTrips.length); console.log('demoStops =', demoStops.length);"
demoTrips = 9
demoStops = 10
```

e2e 深路径模块（与 `e2e/support/mock-fixtures.ts` 完全一致的导入关系）：

```
$ pnpm exec tsx -e "import('./e2e/support/mock-fixtures.ts').then((m) => console.log('e2e deep-path import OK :: MOCK_TRIP_COUNT=' + m.MOCK_TRIP_COUNT, 'BY_STATUS=' + JSON.stringify(m.MOCK_TRIP_COUNT_BY_STATUS)))"
e2e deep-path import OK :: MOCK_TRIP_COUNT=9 BY_STATUS={"active":1,"upcoming":1,"planning":1,"completed":4,"wishlist":2}
```

### 4) Playwright e2e 冒烟（只列用例，不执行）

```
$ pnpm exec playwright test --list
Listing tests:
  [web] › a11y\web\axe.spec.ts:6:3 › @axe web dashboard has no serious or critical findings
  [web] › web\dashboard.spec.ts:5:1 › dashboard renders real travel stats and next journey
  ...
  [admin] › admin\content.spec.ts:4:1 › content moderation soft deletes and restores with confirmation
  [api] › api\smoke.spec.ts:12:1 › API health responds with HTTP 200
Total: 58 tests in 19 files
[exit code: 0]
```

`e2e/web/dashboard.spec.ts`、`e2e/web/trips.spec.ts` 是本仓库中 import `mock-fixtures.ts` 的两个 spec，两者均成功出现在列表中。

### 附加检查

```
$ pnpm --filter @roamlog/api-mocks lint
$ eslint -c ../../eslint.config.mjs .
[exit code: 0]

$ pnpm exec tsx -e "import('./packages/api-mocks/src/handlers.ts').then((m) => console.log('handlers import OK ::', m.handlers.length, 'handlers'))"
handlers import OK :: 19 handlers
```

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（1,672 files / 26,073 nodes）。
- `codegraph_explore "demo-content.ts demoTrips demoStops fixtures.ts StopSchema TripSchema address bbox originAddress originBbox"` → 命中 `packages/api-mocks/src/demo-content.ts:588`（`demoStops`，`StopSchema.parse`）与 `packages/api-mocks/src/fixtures.ts:276`（`demoTrips`，`TripSchema.array().parse`）；blast radius 显示 `demoStops` 的 3 个调用方（`handlers.ts`、`demo-content.ts`），测试调用方包含 `e2e/support/mock-fixtures.ts` 与 `packages/api-mocks/src/__tests__/fixtures.test.ts`，与本次修复的直接动机一致。
- `codegraph_explore "MediaSchema JournalEntrySchema PublicStopSchema PublicTripSchema entities/media.ts entities/journal-entry.ts entities/public.ts"` → `MediaSchema` 定义在 `packages/contracts/src/entities/media.ts:11`，`JournalEntrySchema` 定义在 `journal.ts:11`（二者自冻结以来无变更）；`PublicStopSchema` / `PublicTripSchema` 只存在于 `packages/contracts/src/api/share-links.ts:37/56`，api-mocks 无构造点。

## 已知风险

- 演示用 stop 的 `address`/`bbox` 全部取 `null`（契约允许）。因此 mock 模式下 Web 不会展示地点地址文本；非空值只由单元测试覆盖。`apps/web/test/fixtures/content.ts`（提交 `9974191`）已用「首尔/京都非空 + 其余 null」的写法，若产品要求 mock 模式也展示地址，可对齐该写法。
- `packages/contracts` 仍被其它 Agent 修改（工作树存在未提交的 `packages/contracts/src/api/index.ts` 一行改动）。本报告结论基于当前工作树快照；若契约再次新增必填键，需要重跑 api-mocks 测试。
- `demo-content.ts` / `fixtures.test.ts` 在 HEAD 版本即已不符合 Prettier（已用 `git show HEAD:... | prettier --stdin-filepath` 复核，非本次引入）；为避免制造无关 diff，未做整文件格式化。
- 仓库工作树中有大量其它 Agent 的并行改动，本次只 `git add` 了 3 个 `packages/api-mocks` 文件，提交未包含任何越界路径。

## 未覆盖项

- 未真正执行 Playwright 用例（按任务要求只 `--list`），未启动 Web/Admin/API 服务，因此运行期 MSW 响应内容未在浏览器中验证。
- `handlers.ts` 仅 Node 冒烟 import；各分页响应 schema 未逐一 `safeParse`（它们不构造 `Stop`/`Trip`，且本次盘点确认无新增字段依赖）。
- `apps/admin`、`apps/api` 对 fixtures 的间接消费不在本次边界内。
- 视觉回归：未生成截图。

## 建议下一步

1. 并行任务合流后，由根 Agent 跑一次 `pnpm exec playwright test --project=web`（或 `pnpm e2e:web`），确认 mock 模式页面在运行期仍全绿。
2. 若产品需要 mock 模式展示地点地址，把首尔/京都 stop 的 `address`/`bbox` 换成真实值（与 `apps/web/test/fixtures/content.ts` 对齐），并同步任何读取地址文本的 e2e 断言。
3. 后续契约新增必填字段时，把 api-mocks 的 `StopSchema.parse` / `TripSchema.parse` 作为 Wave 0 的编译门禁一并跑，避免再次出现 import 阶段崩溃。