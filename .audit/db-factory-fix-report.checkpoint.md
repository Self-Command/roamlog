# DB_FACTORY_FIX — checkpoint

- 状态: DONE（db 范围）
- 时间: 2026-11-18 21:07 +08:00
- 改动: `packages/db/src/factories.ts` +4 行（`makeTrip` 显式 `originLat/originLng/originCountryCode/timeZone: null`，L97–L100），`...overrides` 位置不变
- 未改: schema.prisma / migrations / generated / apps / 其它 packages
- 验证:
  - `codegraph status` → `[OK] Index is up to date`
  - `pnpm --filter @roamlog/db typecheck` → exit 0
  - `pnpm --filter @roamlog/db test` → 26 passed / 6 skipped（无 ROAMLOG_TEST_DATABASE_URL，集成项跳过）
  - `pnpm --filter @roamlog/api typecheck` → exit 2，但 0 个 packages/db 错误（原 TS2719 已消失）；6 个错误全在 `apps/api/src/modules/trips/trips.service.ts` + `apps/api/test/content-trips.e2e-spec.ts`，owner = trips Agent
  - `git diff packages/db/src/factories.ts` → 仅 4 行新增
- 结论: `makeStop` 不存在（codegraph 索引缺失 + 全仓 grep 0 命中），Stop 新列无工厂需补
- 待办（非本任务）: trips Agent 补 `TripCreateData` 4 字段、实现 `resolveCovers`、修 e2e 构造参数
- 完整证据: `.audit/db-factory-fix-report.md`