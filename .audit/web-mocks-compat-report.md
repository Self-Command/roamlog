# WEB_MOCKS_COMPAT — Web mock/demo 契约适配报告

状态: DONE
任务 ID: WEB_MOCKS_COMPAT

## 变更文件

| 文件 | 变更 | 说明 |
| --- | --- | --- |
| `packages/api-mocks/src/fixture-defaults.ts` | +5 / -0 | tripDefaults 补 5 个新必填字段的空值 |
| `packages/api-mocks/src/fixtures.ts` | +10 / -2 | 9 条 trip seed 统一计算 `durationDays` |
| `packages/api-mocks/src/demo-content.ts` | +13 / -10 | 10 条 stop seed 补 provider 相关字段与 timeZone |
| `apps/web/components/share/demo-share.ts` | +9 / -2 | PublicTrip / PublicMedia 形状适配 |

未改动：`apps/web/lib/demo-store.tsx`、`apps/web/components/app-shell/**`、`apps/api/**`、`packages/contracts/**`、`packages/api-client/**`、`packages/db/**`、`apps/admin/**`。

## 实现摘要

1. **`fixture-defaults.ts`**
   - `tripDefaults` 增加 `cover: null`、`originLat: null`、`originLng: null`、`originCountryCode: null`、`timeZone: null`。
   - `durationDays` 未写入默认值，保持由每条 trip 的 `startDate`/`endDate` 计算，避免死值漂移。

2. **`fixtures.ts`**
   - 把 9 条 trip 字面量抽为 `tripSeeds`，统一执行：
     `TripSchema.array().parse(tripSeeds.map((trip) => ({ ...trip, durationDays: tripDurationDays(trip.startDate, trip.endDate) })))`。
   - `tripDurationDays` 从 `@roamlog/contracts` 导入；`coverMediaId` 仍为 null，因此 `cover` 由 defaults 提供为 null，满足 `Trip.cover` 字段必须存在但可 null 的契约。
   - `TripSchema.parse`（数组）对 9 条 trip 全部通过，`durationDays` 为含首尾的日期跨度。

3. **`demo-content.ts`**
   - `stopSeeds` 类型新增 `provider: "photon" | "local"`、`providerPlaceId: string | null`、`timeZone: string`。
   - 10 条 stop 全部补齐：
     - `provider`：8 条 `photon`，奈良、百内使用 `local`；
     - `providerPlaceId`：photon 使用 `photon:node/<synthetic-id>`，local 使用 null（契约允许的组合）；
     - `timeZone`：`Asia/Seoul`（首尔/釜山）、`Asia/Tokyo`（京都/奈良）、`Atlantic/Reykjavik`（雷克雅未克/维克）、`Europe/Lisbon`（里斯本/辛特拉）、`Europe/Rome`（索伦托）、`America/Punta_Arenas`（百内），与城市匹配。
   - `StopSchema.parse` 对 10 条 stop 全部通过；`handlers.ts` 的 `StopListResponseSchema.parse` 随之为绿。

4. **`demo-share.ts`**
   - `PublicTrip` 部分补 `durationDays: trip.durationDays`、`cover: trip.cover`（当前 fixtures 为 null，字段存在且合法）。
   - `publicMedia` 明确返回 `PublicMedia`，移除 strict 禁止的 `variants`，补：
     - `url`: `https://media.example.invalid/mock/display/<uuid>.jpg`
     - `thumbUrl`: `https://media.example.invalid/mock/thumb/<uuid>.jpg`
     - `expiresAt`: `2027-01-01T00:00:00.000Z`
   - 使用保留 TLD `.invalid`，URL 一眼可辨为测试数据，不可真实访问，不会进入生产 API 路径。

5. **`handlers.ts` / `demo-store.tsx` 审计结论**
   - `handlers.ts` 只 parse 现有 fixtures，没有构造 `PublicTripResponse` / `PublicMedia`，无需改动。
   - `demo-store.tsx` 只做 fixtures 浅拷贝；`updateTrip` patch 仅 `title/summary/status/favorite`；新增 itinerary/expense/packing/media 的形状未受新契约影响；没有 Trip/Stop 的运行时 parse。按“只修被新契约拒绝的数据形状、不改状态机”的边界，未改动该文件。

## 验证命令与结果

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @roamlog/web build` | **exit 0**，Compiled successfully，10/10 static pages，19:30 | `.audit/evidence/web-mocks-compat/build-post-concurrent.log`、`build-final.log` |
| `pnpm --filter @roamlog/web typecheck` | **exit 0**（next typegen + tsc --noEmit） | `web-typecheck-final.log` |
| `pnpm --filter @roamlog/web test` | **15 files / 51 tests passed**，19:34 | `web-test-final2.log` |
| `pnpm --filter @roamlog/api-mocks test` | **3 tests passed**，exit 0 | `api-mocks-test-final.log` |
| `pnpm --filter @roamlog/api-mocks typecheck` | **exit 0** | `api-mocks-typecheck-final.log` |
| `pnpm exec tsx /c/tmp/opencode/verify-demo-share.ts` | `validated 9 public trip payloads; 10 stops; 28 media`，exit 0 | `public-share-runtime-validation.log` |

Baseline 复现：`build-before.log`（18:49）显示 `StopSchema.parse` 在 `demo-content.ts:586` 报 `provider` / `providerPlaceId` / `timeZone` 三项 ZodError，`/_not-found` 预渲染中止，与交接报告 F1 完全一致。

并发说明：19:07 与 19:24 的全量 web test 曾出现 `app-shell.test.tsx` 的 2 个 UI 断言失败与一次模块加载失败（`user-footer.tsx`），均来自另一 Agent 正在改的 `apps/web/components/app-shell/**`；该 Agent 落盘后，19:32 单独 app-shell 测试 13/13 通过，19:34 全量 51/51 通过。本任务未改 app-shell，最终结果不受其影响。

## 截图/日志/接口证据

目录：`.audit/evidence/web-mocks-compat/`

```
build-before.log                     # F1 失败基线（ZodError）
build-after.log / build-final.log    # 修复后首次/最终构建
build-post-concurrent.log            # 并发修改期间复跑构建，exit 0
web-typecheck-final.log              # web typecheck
web-test-final2.log                  # 51/51
web-test.log                         # 并发期间含 app-shell 失败的记录
web-test-final.log                   # 并发期间 app-shell suite 加载失败记录
web-app-shell-test.log               # 并发 Agent 修复后 app-shell 13/13
api-mocks-test-final.log             # 3/3
api-mocks-typecheck-final.log        # exit 0
public-share-runtime-validation.log  # 9 trips / 10 stops / 28 media 运行时校验
web-share-test.log                   # share 4/4
changed-files-stat.log               # 变更文件统计
web-mocks-compat.diff                # 本次全部代码 diff
codegraph-evidence.log               # CodeGraph 查询原始输出
codegraph-status-final.log           # [OK] Index is up to date
```

接口级证据：一次性脚本对 `demoFixtureState` 的 9 条 trip 全部调用 `buildDemoPublicTrip` 并用 `PublicTripResponseSchema.parse` 校验，同时断言每条 media URL 以 `https://media.example.invalid/mock/` 开头、`payload.trip.durationDays === tripDurationDays(startDate,endDate)`。

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`；索引 1,358 files / 20,091 nodes / 42,550 edges（修复后 sync 完成）。
- 初始查询 `codegraph explore "tripDefaults demoStops PublicTripResponse demoShare fixtures"` → 37 symbols / 8 files；命中 `tripDefaults`（fixture-defaults.ts:3，1 caller fixtures.ts）、`demoStops`（demo-content.ts:585，5 callers：handlers、demo-store）、`PublicTripResponse`（contracts share-links.ts:114，11 callers 含 demo-share/public-share-page/API service）、`DemoShareResolution`（demo-share.ts:17，3 callers）。
- 复跑查询 `codegraph explore "tripDefaults tripDurationDays demoStops publicMedia PublicTripResponse"` → 42 symbols / 7 files；`tripDurationDays`（contracts entities/trip.ts:43）7 callers，包含 `packages/api-mocks/src/fixtures.ts`；`publicMedia`（demo-share.ts:143）1 caller，测试经 `apps/web/components/share/share.test.tsx` 覆盖。
- 原始输出：`.audit/evidence/web-mocks-compat/codegraph-evidence.log`。

## 已知风险

- Mock URL 使用保留 TLD `.invalid`，任何真实图片加载都会失败；这是刻意的“一眼测试数据”设计，当前分享页不渲染图片，不影响构建与演示文案。
- `expiresAt` 固定为 `2027-01-01T00:00:00.000Z`；该日期之后 mock 数据在语义上属于“已过期”，但契约只校验 ISO 字符串，不影响构建/测试。Wave 2 可改为相对生成或占位策略。
- `apps/web/lib/demo-store.tsx` 的 localStorage key 仍为 `roamlog:wave2-demo-state:v1`，旧浏览器状态可能恢复缺少 `durationDays`/`cover` 的 trip 对象。当前代码不对 store 数据做契约 parse，UI 也不读取这两个字段，故不阻塞；若 Wave 2 开始依赖它们，需要迁移或 bump key。
- app-shell 仍由并行 Agent 持续修改，任一时刻的集成构建/测试可能被其半成品影响；本报告以 19:30 build 与 19:34 全量 test 为准。

## 未覆盖项

- 未运行 API / DB / admin 构建（任务明确禁止）；F2（API presenter 的 durationDays/cover/PublicMedia 适配）不在本任务范围。
- 未做浏览器视觉/截图验证；本任务为数据契约修复，无 UI 结构变更。
- 未新增永久回归测试；仅在 `fixtures.test.ts` 现有覆盖之外做了一次性 9 条 PublicTripResponse 运行时校验。当前 `fixtures.test.ts` 已覆盖 Trip/Stop schema，`share.test.tsx` 覆盖默认 trip 的 PublicTripResponse parse。
- `handlers.ts` 没有 public share 端点，未用 MSW 路径验证 PublicTripResponse；验证走的是 `demo-share.ts` 真实函数。

## 建议的下一步

1. 等所有并行 Agent 落盘后，由根 Agent 重跑 `pnpm --filter @roamlog/web build` 与 `pnpm --filter @roamlog/web test` 做集成验收，并继续 F2 的 API presenter 修复。
2. Wave 2 移除 MSW/demo 基础设施前，为 demo localStorage 增加版本迁移或 bump `STORAGE_KEY`，避免旧状态缺字段。
3. 如需长期防回归，在 `packages/api-mocks/src/__tests__/fixtures.test.ts` 增加 `durationDays === tripDurationDays(...)` 与 stop provider/timeZone 断言；在 web share 测试中覆盖更多 trip 的 PublicTripResponse。
4. 分享页若要展示真实封面/图片，必须接入真实 media presenter；禁止把 `.invalid` mock URL 带入生产 API 路径。
