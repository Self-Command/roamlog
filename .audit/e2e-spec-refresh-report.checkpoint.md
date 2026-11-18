# E2E_SPEC_REFRESH — checkpoint

- 任务：修复因本轮重构而过期的既有 Playwright 用例（CI quality-gate 跑 `dashboard renders real travel stats and next journey`）。
- 状态：DONE（含 1 项越界风险：axe 7 条产品无障碍回归，非 spec 过期，需前端修）。
- CodeGraph：`codegraph status` → `[OK] Index is up to date`；已执行 `codegraph explore "DashboardPage dashboard-page.tsx dashboard-recent.tsx insights-workspace trips-library"`。
- 已改文件：`e2e/web/dashboard.spec.ts`、`e2e/web/trips.spec.ts`、`e2e/support/fixtures.ts`（仅类型收窄）、新增 `e2e/support/mock-fixtures.ts`。
- 关键结论：`MSW DEVELOPMENT DATA` 已不存在 → 改为 `本地演示数据（非真实）`；统计卡数值改为从 fixtures 推导；`预算分布` 仍存在（`dashboard-recent.tsx:80`），保留断言。
- 回归发现：mock 模式下 trip detail 仍渲染 `legacy-mock/trip-detail`（概览/日志/行程/相册/地图/预算/打包/活动），因此 planning/trips/a11y 的 tab 断言**未过期**，无需改。
- 验证：`E2E_WEB_URL=http://localhost:3300 E2E_SKIP_WEB_SERVER=1 E2E_SKIP_ADMIN_SERVER=1` → 目标用例 1 passed；`e2e/web --project=web` 10 passed；tsc（我的文件）exit 0。
- 端口：3300 dev server 已停止；3000 未触碰。因 `.next/dev/lock` 被 3000 占用，改用 `.data/e2e-shadow-3300` 影子副本（已删除）。
- 待跟进：axe `label-content-name-mismatch`（`topbar-members.tsx`）需产品侧修复；live/staging spec 未在本机执行。