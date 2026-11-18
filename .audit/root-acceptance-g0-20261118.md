# 根 Agent 验收记录 — G0 交接验收

任务 ID: W0_HANDOFF_QA
验收结论: **CHANGES_REQUESTED（ACCEPT = NO）**
验收时间: 2026-11-18 18:39 (Asia/Shanghai)
验收依据: `.audit/2026-11-18-handoff-acceptance-report.md` + `.checkpoint.md` + `.audit/evidence/handoff-2026-11-18/`（15 份脱敏日志）
快照口径: 2026-11-18 18:07，main@b96ca9b，84 条未提交；18:26 后树被并行任务改动。

## 通过的验证

- `pnpm contracts:check` exit 0：OpenAPI 92 paths / 203 schemas fresh；api-client 23 endpoints / 593 schemas fresh；4 个删除的 `*Variants.ts` 零残留引用。
- typecheck：contracts / api / web / admin 全部 exit 0。
- 单测：contracts 52 通过；api admin-audit.spec 4 通过；admin dashboard-view 4 通过；admin 全量 44 通过；db 21 通过（含 seed integration）。
- `pnpm --filter @roamlog/admin build` exit 0。
- 真实 PostgreSQL（embedded 17.11，port 55440，已 stop）：2 条迁移空库全应用、二次幂等、migrate status 干净。
- `admin-audit-uuid-compat.e2e-spec.ts` 1/1 通过：UUIDv4 审计行下 `/v1/admin/audit`、`/audit/export`、`/metrics`、`/emails` 全 200，响应含 v4 id。
- “仅放宽读取”成立：Prisma 新记录 id version nibble=7；schema 未改；无迁移；v4 行回读 id 不变；非法 UUID 仍被拒。
- 总览降级正确：单源失败只降该区块；auth 失败整页失败；metrics 失败时 0 值被 `metricsReady` 门控；refetch/degraded 正确；无 any/ts-ignore/空 catch。
- 边界：无越界改动（`.gitignore` 新增 `.codegraph/` 属良性卫生项）；无密钥/DSN/真实邮箱/内网 IP。

## 发现的问题与归属

| ID | 级别 | 问题 | Owner | 处置 |
|---|---|---|---|---|
| F1 | HIGH | `pnpm --filter @roamlog/web build` exit 1：`packages/api-mocks/src/demo-content.ts:586 StopSchema.parse` 缺 `provider/providerPlaceId/timeZone`，Trip 也缺新字段 | WEB_MOCKS_COMPAT | 已派单 |
| F2 | CRITICAL | API 全量测试 8 failed / 257 passed：`presentTrip`/`presentStop`/公开分享 payload 未适配新契约；`POST /v1/trips` 实测 500 | API_READ_SHAPE | 已派单 |
| F4 | MEDIUM | `AdminAuditQuerySchema.actorId` 仍 `UuidV7Schema`，按历史 v4 actorId 过滤会 400 | 后续 W0/W3 | 记录，暂不修 |
| F5 | LOW | build/typegen 改写受版本控制的 `apps/{admin,web}/next-env.d.ts` | ROOT | 提交前用 `git show HEAD:path > path` 还原，禁用 checkout |
| F6 | INFO | dashboard 致命分支无直接单测；`isLoading` 用 `every` 语义需注释 | fix_admin_p0（后续） | 记录 |

## 未覆盖

`test/admin-routes.e2e-spec.ts`、Web/Admin E2E、a11y、视觉回归、staging、lint、`/places/search` 实现侧。

## 判定

- Admin P0 的核心修复（审计 v4 读取 + 总览降级）**证据充分，可接受**。
- 但整棵树不是绿的：Web build 与 API 运行时被契约先行打破，**G0 不通过**，不得提交/部署。
- 解除条件：F1 + F2 修复并复跑 `web build` 与 `api test`（期望 8 项转绿），再跑 G1/G2。
