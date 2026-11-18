# WEB_SHELL_CLEANUP checkpoint

- Status: done
- Completed: 2026-11-18T21:29:00+08:00
- CodeGraph: `codegraph status` -> `[OK] Index is up to date`; explore query shows `InsightsWorkspace -> useInsightsData -> fetchExpenses` and `AtlasWorkspace -> useAtlasData -> fetchStops`.
- Result:
  - Dashboard/Insights/Atlas/Trips library now read the data adapter; api mode uses real endpoints, mock mode keeps MSW/demo data behind a mock-only "本地演示数据（非真实）" badge.
  - Added `fetchExpenses` / `fetchStops` adapter methods (real + mock).
  - Atlas uses only real Stop lat/lng; removed country-center/jitter fixture markers and cross-trip route line.
  - Trips cards use real cover / budget / durationDays; missing budget omitted; fake presence removed.
  - Insights adds real trips/entries/expenses aggregation with per-currency totals and explicit `— / 尚未接入` for route distance; multi-currency conversion not faked.
  - Static fake string grep: 0 hits.
- Tests: 18 files / 64 tests passed. Scoped required suite: 4 files / 14 tests passed. ESLint scoped: clean.
- Typecheck caveat: official `pnpm --filter @roamlog/web typecheck` fails only on concurrent untracked WIP `apps/web/components/forms/searchable-combobox.tsx` (TS6196 `SearchableError` unused). Excluding that WIP file, `tsc -p` exits 0.
- Visual caveat: shared dev server 3000 is stuck at `LOCAL DEVELOPMENT BOUNDARY 正在准备本地旅行数据`; 12 Playwright viewport/page probes found no fake strings but could not capture loaded pages. Did not start a competing server.
- Report: `.audit/web-shell-cleanup-report.md`.
- Known global risk: `components/providers.tsx` still statically imports `DemoDataProvider`; out of allowed write scope, needs follow-up to lazy-load fixtures in api mode.