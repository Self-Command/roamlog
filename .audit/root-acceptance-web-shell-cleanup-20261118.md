# 根 Agent 验收记录 — WEB_SHELL_CLEANUP

任务 ID: WEB_SHELL_CLEANUP
验收结论: **ACCEPT（条件：providers.tsx 引体隔离 + 详情 mock tab 替换）**
时间: 2026-11-18 21:35
交付: `.audit/web-shell-cleanup-report.md`

## 根 Agent 亲自复核

- **假字符串清零**：`grep -rnE "9 趟|¥18,800|MSW DEVELOPMENT DATA|没有生产后端写入" apps/web`（排除 test）→ **0 命中**。这是本轮最关键的验收点，已达成。
- `vitest run` 全量 18 files / 64 tests 通过；目标范围 4 files / 14 tests 通过；改动文件 ESLint clean。

## 通过

- 总览/洞察/地图/旅行库不再直接读 `demo-store`/fixtures，统一走 `DataAdapter` + React Query；新增 `fetchStops`/`fetchExpenses`（real + mock）。
- 洞察页按真实 trips/entries/expenses 客户端聚合；无数据 → 「还没有足够的旅行数据」；**多币种不折算、按币种分列**（正确，避免假汇率）；路线距离无端点 → 「— / 尚未接入」。
- 地图页只使用真实 Stop `lat/lng`；删除国家中心点 + jitter、跨旅行假连线、`HOME·SHANGHAI`、`FIXTURE COORDINATES`；无坐标 → 空状态并提示缺失数量。
- 演示徽标仅在 mock 模式渲染「本地演示数据（非真实）」；api 模式无 MSW 徽标、无过期文案。
- 旅行库卡片用真实 `cover`、仅在有预算时渲染预算行、天数用 `trip.durationDays`；移除占位文案与假在线状态。

## 条件项（本轮未达成，已排后续）

1. **`apps/web/components/providers.tsx` 仍静态 import `DemoDataProvider`**（L16），即使运行时被 `mocksEnabled` 门控，fixtures 代码仍进入全局 bundle。必须改懒加载/仅 mock 挂载。
2. `apps/web/components/trip-detail/**`（activity/budget/itinerary/journal/overview/packing/photos/trip-map 共 9 个 tab）与 `apps/web/components/trips/trip-detail.tsx` 仍 import `demo-store`——这正是用户投诉的「mock tab」。需由 `WEB_TRIP_WORKSPACE` 用真实 tab 替换后删除。
3. 洞察/Atlas 每趟旅行各请求一次 expenses/stops，100 趟时有 N+1 并发风险；需后端 workspace 级聚合端点（记为 API 后续项）。
4. 视觉回归未完成：共享 dev server 3000 卡在「LOCAL DEVELOPMENT BOUNDARY 正在准备本地旅行数据」，390/820/1440 未截图。由 `WEB_VISUAL_QA` 或 G3 补。

## 未覆盖

官方 `web typecheck` 当前被并行 WIP `components/forms/searchable-combobox.tsx(65,11) TS6196` 阻塞（属 `WEB_TRIP_FORM` 在途）；该 Agent 用临时 tsconfig 排除后 exit 0，临时配置已删除。合并前必须以官方命令复跑。