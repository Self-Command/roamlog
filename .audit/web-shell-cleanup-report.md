# Web Shell Cleanup Report

状态: DONE
任务 ID: WEB_SHELL_CLEANUP
日期: 2026-11-18
角色: web_frontend

## 变更文件

数据层：

- `apps/web/lib/api/types.ts`
- `apps/web/lib/api/real.ts`
- `apps/web/lib/api/mock.ts`

总览 / 洞察 / 地图：

- `apps/web/components/dashboard/dashboard-page.tsx`
- `apps/web/components/dashboard/dashboard-recent.tsx`
- `apps/web/components/charts/insights-workspace.tsx`
- `apps/web/components/charts/insights-model.ts`（新增，纯聚合与货币格式化）
- `apps/web/components/charts/insights-data.ts`（新增，真实数据查询与分页）
- `apps/web/components/map/atlas-workspace.tsx`
- `apps/web/components/map/atlas-data.ts`（新增，真实 trip + stop 查询）
- `apps/web/components/map/atlas-map.tsx`
- `apps/web/components/map/map-fallback.tsx`
- `apps/web/components/map/world-map.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/insights/page.tsx`

旅行库：

- `apps/web/components/trips/trips-library.tsx`
- `apps/web/components/trips/trip-card.tsx`

测试：

- `apps/web/components/dashboard/dashboard-page.test.tsx`（新增）
- `apps/web/components/charts/insights-workspace.test.tsx`（新增）
- `apps/web/components/map/atlas-workspace.test.tsx`（重写）
- `apps/web/components/trips/trips-library.test.tsx`（新增）
- `apps/web/test/fake-data.ts`（新增）
- `apps/web/test/query-harness.tsx`（新增）

## 实现摘要

1. **数据源分治**
   - 总览、洞察、地图、旅行库全部改为 `useDataAdapter()` + React Query 查询真实 adapter；`DATA_MODE=api` 时走 `realAdapterInstance`（`/v1/me`、`/v1/me/workspaces`、`/v1/workspaces/:id/trips`、`/v1/workspaces/:id/entries`、`/v1/trips/:id/expenses`、`/v1/trips/:id/stops`）。
   - 给 `DataAdapter` 增加 `fetchExpenses(tripId, params, signal)` 与 `fetchStops(tripId, signal)`；real/mock 两个 adapter 均实现。mock 实现仍通过 MSW handler（已存在）返回本地数据。
   - 洞察页按真实 trips / entries / expenses 聚合；分页最多 20 页（每页 100），超过即显式提示范围。
   - 地图页只使用真实 `Stop.lat/lng`；删除 `COUNTRY_CENTERS`、按国家中心点抖动、`HOME · SHANGHAI`、fixture 连线等假坐标逻辑。没有坐标时显示空状态，并提示有多少停靠点缺少经纬度。
   - 总览国家/城市/天数/预算均从真实 `Trip` 字段计算；预算缺失显示 `—`，不再用 fixture 金额。
   - 旅行库卡片封面使用 `trip.cover.url/thumbUrl`；预算行仅在 `budgetAmountMinor + budgetCurrency` 都存在时渲染；天数使用 `trip.durationDays`。
   - 多币种不做汇率折算：总支出只汇总工作区默认币种，其他币种单独列出；预算行只对比同币种支出。
   - 路线距离没有对应后端聚合端点，明确显示 `—` 与「尚未接入」，不硬编码。

2. **MSW / 演示数据隔离**
   - `components/providers.tsx` 原有边界已确认：`DATA_MODE === "mock" && NODE_ENV !== "production"` 才启动 MSW；本次未改该文件。
   - 本次改动的总览/洞察/地图/旅行库组件不再 import `@/lib/demo-store`、`@roamlog/api-mocks/fixtures` 或 handlers。
   - 删除无条件 `MSW DEVELOPMENT DATA` 徽标与「没有生产后端写入」文案。
   - 仅 mock 模式渲染「本地演示数据（非真实）」徽标 + 「当前数据来自本地 MSW fixtures，仅用于开发演示」说明；api 模式完全不渲染。
   - mock 模式下页面文案改为「本地演示旅行 / 本地演示数据」，不再声称是真实数据。

3. **空状态 / 加载 / 错误**
   - 加载态统一 Skeleton。
   - 空状态统一 `@roamlog/ui` 的 `EmptyState`：总览「还没有旅行」、洞察「还没有足够的旅行数据」、地图「还没有可显示的地图坐标」、旅行库「旅行库还是空的」。
   - 错误态统一 `ErrorState`，均有「重新加载」按钮；洞察的分页查询失败也可重试。
   - 洞察各图表无数据时分别显示真实空状态（月度支出、分类支出、预算对比、热力图）。

4. **视觉与可访问性**
   - 保留真黑画布、编辑衬线标题、mono 元数据、hairline 分隔。
   - 总览保留「新建旅行」为唯一白色 primary；洞察导出为 outline，地图视图切换为 subtle/ghost。
   - 移除了由 `trip.status === "active"` 推导的假在线头像状态（dashboard / trip-card / atlas）。
   - 删除「URL 状态将在 Wave 1 接入」等过期占位文案、`FORM SKELETON` 类文案不在本任务范围。
   - 地图标记、筛选按钮、列表项均保留键盘可达性；无新增动画，沿用 reduced-motion 处理。

## 验证命令与结果

1. `codegraph status` → `[OK] Index is up to date`（文件 1,373 / 节点 20,402 / 边 43,372）。
2. `codegraph explore "InsightsWorkspace useInsightsData AtlasWorkspace useAtlasData DashboardPage TripsLibrary fetchStops fetchExpenses"` → 命中 7 文件 / 47 symbols；调用链 `InsightsWorkspace → useInsightsData → fetchExpenses`、`AtlasWorkspace → useAtlasData → fetchStops`。
3. `pnpm --filter @roamlog/web exec vitest run components/dashboard components/trips components/map` → **4 files / 14 tests passed**。
4. 扩展：`... vitest run components/dashboard components/charts components/map components/trips lib/api/real.test.ts` → **6 files / 22 tests passed**（含洞察 4、地图 4、总览 3、旅行库 4、trip-map 3、real adapter 4）。
5. 全量 web Vitest：`pnpm --filter @roamlog/web exec vitest run` → **18 files / 64 tests passed**。
6. 静态假字符串检查：
   `grep -rnE "9 趟|¥18,800|MSW DEVELOPMENT DATA|没有生产后端写入" apps/web --include=*.tsx | grep -v test`
   → **0 命中**（grep exit 1）。
7. `pnpm exec eslint -c ../../eslint.config.mjs components/dashboard components/charts components/map components/trips/trips-library.tsx components/trips/trip-card.tsx` → **exit 0，无输出**。
8. `pnpm --filter @roamlog/web typecheck` → **被并行任务阻塞**，唯一错误来自未跟踪的 WIP 文件 `apps/web/components/forms/searchable-combobox.tsx(65,11): TS6196 'SearchableError' is declared but never used`（WEB_TRIP_FORM 正在写该文件）。使用临时 `tsconfig` 排除该并发 WIP 文件后 `tsc -p ... --noEmit` → **exit 0，无错误**；临时配置已删除。
9. Playwright 尝试访问共享 dev server `127.0.0.1:3000`（390 / 820 / 1440 × 总览/洞察/地图/旅行库）：页面停留在 `LOCAL DEVELOPMENT BOUNDARY 正在准备本地旅行数据`，12 个组合均无 `9 趟 / ¥18,800 / MSW DEVELOPMENT DATA / 没有生产后端写入`；因共享 dev server 的 MSW 启动卡住，未能取得真实页面截图（未抢占 3000，也未另起 dev server）。

## 截图 / 日志 / 接口证据

- Vitest 输出：
  `Test Files 18 passed (18) / Tests 64 passed (64)`。
- 静态检查：`grep_exit=1`（无命中）。
- Playwright 日志：`WebSocket connection to ws://127.0.0.1:3000/_next/hmr... failed`，页面文案固定为 `LOCAL DEVELOPMENT BOUNDARY 正在准备本地旅行数据`；这是共享 dev server/MSW 的启动故障，不是页面数据泄漏。
- 接口契约证据：
  - `packages/contracts/src/api/stops.ts` → `StopListResponseSchema`
  - `packages/contracts/src/api/expenses.ts` → `ExpensePageSchema`
  - `packages/api-client/src/generated/endpoints/stops/stops.ts` → `GET /v1/trips/{tripId}/stops`
  - `packages/api-client/src/generated/endpoints/expenses/expenses.ts` → `GET /v1/trips/{tripId}/expenses`
  - `apps/api/src/modules/expenses/expenses.controller.ts` 已存在 `@Get("trips/:tripId/expenses")` 与 `@Get("trips/:tripId/budget/summary")`。

## CodeGraph 证据

- 查询：`codegraph status` → `[OK] Index is up to date`。
- 查询：`codegraph explore "InsightsWorkspace useInsightsData AtlasWorkspace useAtlasData DashboardPage TripsLibrary fetchStops fetchExpenses"`。
- 关键结果：
  - `InsightsWorkspace (insights-workspace.tsx:64) → useInsightsData (insights-data.ts:36) → fetchExpenses (lib/api/types.ts:148)`。
  - `AtlasWorkspace (atlas-workspace.tsx:69) → useAtlasData (atlas-data.ts:9) → fetchStops (lib/api/types.ts:147)`。
  - `InsightsPage → InsightsWorkspace`、`MapPage → AtlasWorkspace`、`WorkspaceDashboardPage → DashboardPage`、`TripsPage → TripsLibrary` 的动态渲染关系。
  - 测试关联：`useAtlasData` 由 `atlas-workspace.test.tsx` 覆盖；`fetchStops` 由 `atlas-workspace.test.tsx` 覆盖；`fetchTrip` 由 `lib/api/real.test.ts` 覆盖。

## 需要的后端端点（未接入项）

已有可直接调用、本次已接入：

- `GET /v1/workspaces/:workspaceId/trips`
- `GET /v1/workspaces/:workspaceId/entries`
- `GET /v1/trips/:tripId/expenses`
- `GET /v1/trips/:tripId/stops`

仍缺少或未接入：

1. **路线距离聚合**：目前没有真实距离端点，洞察页「路线距离」显示 `—` + 「尚未接入」。需要例如 `GET /v1/trips/:tripId/distance` 或 workspace 级 `GET /v1/workspaces/:id/insights/distance`（按 stop 顺序计算 great-circle / routed distance）。
2. **多币种统一换算**：没有汇率换算端点，总支出与预算对比只按币种分别展示，明确标注「未折算 / 其他币种未计入」；如需统一展示，需要 workspace 级 `GET /v1/workspaces/:id/insights?currency=CNY` 或 FX rate 端点。
3. **workspace 级洞察聚合**：当前由前端对 trips/entries/expenses 分页真实列表做客户端聚合（允许且无造假），但当旅行 > 100 或记录 > 2000 条时只能显示「统计范围为已加载数据」。若要全量精确，需要 `GET /v1/workspaces/:id/insights/summary`。

## 已知风险

- **全局 Providers 仍静态 import DemoDataProvider**：`apps/web/components/providers.tsx` 不在本任务可写文件内，它仍会让 demo fixtures 进入全局 bundle；本次已保证总览/洞察/地图/旅行库路由组件本身不再引用 demo store / fixtures，但“api 模式 bundle 完全不含 fixtures”需要单独的 Providers 懒加载改造。
- **共享 dev server 3000 当前卡在 MSW 启动边界**：无法完成 390/820/1440 实际截图验收；已用 Vitest + Playwright 文本扫描替代。
- **旅行/记录分页上限**：trips 取前 100，entries/expenses 每类最多 20 页 × 100；页面已显式提示范围，未伪造全量。
- **N+1 请求风险**：洞察与 Atlas 目前按每趟旅行各发一次 `expenses` / `stops` 请求；100 趟时可能产生 100 个并发请求。需要后端提供 workspace 级批量端点后再替换。
- **签名封面 URL 过期**：卡片使用 API 返回的 `cover` URL；URL 过期时浏览器会显示空图，需要后端刷新签名或前端重取 trip。
- **`typecheck` 受并发任务阻塞**：`components/forms/searchable-combobox.tsx` 是 WEB_TRIP_FORM 的未跟踪 WIP；排除该文件后全量类型检查通过。合并前需等该 Agent 完成并重跑官方命令。
- **空状态文案与图表视觉**：未做真实浏览器视觉回归；建议集成阶段补 390/820/1440 截图。

## 未覆盖项

- 未运行全量 `next build`（按任务要求留给集成阶段）。
- 未修改 `apps/web/components/providers.tsx`、`apps/web/lib/msw.ts`、`apps/web/lib/query.ts`（不在允许写文件内）。
- 未修改 `packages/api-mocks/**`；MSW handlers 已存在 stops/expenses，不需扩展。
- 未处理 `trip-detail-parts.tsx` / `new-trip-shell.tsx` 中仍在的 fixtures 文案（属于其他 Agent 的路径）。
- 未接预算汇总端点 `/budget/summary`；当前用真实 expenses 客户端聚合，避免与契约列口径不一致。

## 建议的下一步

1. 等 `WEB_TRIP_FORM` 合并后重跑 `pnpm --filter @roamlog/web typecheck`，确认官方命令通过。
2. 单独开任务：将 `components/providers.tsx` 中的 `DemoDataProvider` 与 `startMockWorker` 改为仅 mock 动态加载，彻底满足 api 模式 bundle 不含 fixtures/handlers。
3. 后端补 `workspace insights summary`（含距离、FX、全量分页）后，将洞察页客户端聚合替换为服务端聚合；在此之前保持当前真实列表聚合与「尚未接入」文案。
4. 用全新的 dev server 补 390/820/1440 × 总览/洞察/地图/旅行库截图与键盘遍历。
5. 若产品需要跨币种总额，先定义展示币种与汇率来源，再开放统一金额，不要在前端隐式换算。