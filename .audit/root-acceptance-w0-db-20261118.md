# 根 Agent 验收记录 — W0_DB

任务 ID: W0_DB
验收结论: **ACCEPT（含 2 项后续决定）**
验收时间: 2026-11-18 19:12 (Asia/Shanghai)
交付: `.audit/w0-db-report.md` + `.checkpoint.md`
变更: `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/0003_w0_trip_stop_place_metadata/migration.sql`、`packages/db/src/__tests__/migration.w0.test.ts`

## 通过的验证

- 空库 `pnpm db:migrate`：0001→0002→0003 全部成功。
- 存量数据：先应用 0001+0002 → 插 user/ws/member/trip/stop → 应用 0003，旧行保留，新列全 NULL。
- 幂等：`migrate status` = up to date；`prisma migrate diff` = "No difference detected."。
- 约束：6 个新 CHECK（origin pair、lat range、lng range、budget nonnegative、budget pair、Stop provider）全部生效。
- 负例 5/5 返回 23514：单边坐标、负预算、预算单边、坐标越界、非法 provider。
- 合法写入通过（52.52/13.405/DE/Europe/Paris + photon/photon-1）。
- `pnpm --filter @roamlog/db test`：32 passed / 32（含 11 项真实 PG 约束测试 + seed integration）。
- `pnpm --filter @roamlog/db typecheck` exit 0。
- PostgreSQL 17.11 embedded（55441）已 stop，数据目录保留。

## 决定

1. **Stop 复合索引**：本任务不加；等 Places/Stop 去重查询落地后，如需性能再开 0004，避免无依据索引。
2. **timeZone IANA CHECK**：不加 DB 正则；由 contracts 的 `IanaTimeZoneSchema` 兜底，避免 DB 与契约双重规则漂移。
3. `originCountryCode CHAR(2)` 的补空格行为由 `CountryCodeSchema` 在写入前拦截，接受。
4. 迁移命名 `0003_...` 与仓库顺序号风格一致，接受该偏差。

## 剩余风险

- 服务层必须成对写预算（已有 `assertBudgetPair`）；任何直接写库脚本只改单边会 23514。
- Prisma client 需要重新生成后 API 才能看到新列（`prisma generate`）；API 侧透传由 `API_READ_SHAPE`/后续任务负责。
- 未在容器/staging 验证，属发布门禁 G5。
