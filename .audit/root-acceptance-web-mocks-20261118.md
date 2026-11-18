# 根 Agent 验收记录 — WEB_MOCKS_COMPAT

任务 ID: WEB_MOCKS_COMPAT
验收结论: **ACCEPT**
时间: 2026-11-18 19:55
交付: `.audit/web-mocks-compat-report.md` + `.audit/evidence/web-mocks-compat/`

## 通过

- F1 已解除：`pnpm --filter @roamlog/web build` exit 0（10/10 static pages）。
- 修复内容与契约一致：
  - `tripDefaults` 补 `cover/originLat/originLng/originCountryCode/timeZone=null`；
  - 9 条 trip 用 `tripDurationDays()` 派生 `durationDays`，无死值；
  - 10 条 stop 补 `provider`（8 photon / 2 local）、`providerPlaceId`、匹配城市的 IANA `timeZone`；
  - `demo-share` 的 `PublicTrip`/`PublicMedia` 补齐，mock URL 使用保留 TLD `.invalid`，不可真实访问，不进入生产 API 路径。
- `web typecheck` exit 0；`web test` 15 files / 51 tests 通过；`api-mocks test` 3/3；运行时校验 9 trips / 10 stops / 28 media 全通过。
- 基线失败日志保留（`build-before.log`，demo-content.ts:586 ZodError），可复现。
- 未越界：未改 `demo-store.tsx`、app-shell、API、contracts、client、db、admin。

## 备注

- 并发期间（19:07/19:24）app-shell 测试失败来自另一 Agent 半写状态，19:32 后 13/13、19:34 全量 51/51 通过，非本任务回归。
- `packages/api-mocks` 属于 demo/MSW 数据，Wave 2 去 fixture 时仍要整体移除；本任务只保证契约形状与构建绿。
- 未跑 API/DB/Admin 构建（不在范围）。
