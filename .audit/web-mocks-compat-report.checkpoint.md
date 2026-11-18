# WEB_MOCKS_COMPAT — Checkpoint

状态: DONE
任务 ID: WEB_MOCKS_COMPAT
时间: 2026-11-18 19:35 +08:00

## 已完成

- [x] `packages/api-mocks/src/fixture-defaults.ts`：tripDefaults 补 `cover` / `originLat` / `originLng` / `originCountryCode` / `timeZone`（均为 null）。
- [x] `packages/api-mocks/src/fixtures.ts`：trip seeds 统一通过 `tripDurationDays(startDate, endDate)` 计算 `durationDays`，`TripSchema.array().parse` 通过。
- [x] `packages/api-mocks/src/demo-content.ts`：10 条 stop seeds 补 `provider`（photon/local）、`providerPlaceId`（photon:node/… 或 null）、与城市匹配的 IANA `timeZone`；`StopSchema.parse` 通过。
- [x] `apps/web/components/share/demo-share.ts`：PublicTrip 补 `durationDays` / `cover`；PublicMedia 改用 `https://media.example.invalid/mock/...` 的 `url` / `thumbUrl` / `expiresAt`，移除 strict 禁止的 `variants`。
- [x] `handlers.ts` 未构造 PublicTripResponse/PublicMedia，无需改动。
- [x] `apps/web/lib/demo-store.tsx` 审计：仅浅拷贝 fixtures，updateTrip 不涉及新字段，无契约 parse，无需改动（避免越权改状态机）。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @roamlog/web build` | exit 0（10/10 static pages） |
| `pnpm --filter @roamlog/web typecheck` | exit 0 |
| `pnpm --filter @roamlog/web test` | 15 files / 51 tests passed |
| `pnpm --filter @roamlog/api-mocks test` | 3 tests passed |
| `pnpm --filter @roamlog/api-mocks typecheck` | exit 0 |
| 一次性 tsx 运行时校验 | 9 public trip payload / 10 stops / 28 media 全部通过 |

Baseline 失败日志：`.audit/evidence/web-mocks-compat/build-before.log`（ZodError @ demo-content.ts:586）。
修复后证据目录：`.audit/evidence/web-mocks-compat/`。

## 下一步

- 等其余并行 Agent 落盘后由根 Agent 重跑集成构建（本轮 19:30 build / 19:34 全量 web test 均绿，但 app-shell 仍在并发修改）。
- Wave 2 处理 demo localStorage 版本迁移与 MSW/demo 基础设施替换。
