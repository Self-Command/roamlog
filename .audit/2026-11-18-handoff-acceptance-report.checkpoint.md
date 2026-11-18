# W0_HANDOFF_QA — Checkpoint

Task ID: `W0_HANDOFF_QA` · qa_verifier (read-only) · 2026-11-18 18:05–18:35 (+08:00)
Snapshot: branch `main`, HEAD `b96ca9b`, 84 uncommitted entries @ 18:07

## Status: NEEDS_REVIEW (ACCEPT: NO) — 报告已落盘

主报告：`.audit/2026-11-18-handoff-acceptance-report.md`

## Gate
- `codegraph status` → `[OK] Index is up to date`（1,338 files / 19,714 nodes / 41,588 edges）

## Stage 1 — 清单/边界/安全 ✅
- 45 tracked (41M/4D) + 38 untracked；分类：W0_CONTRACTS / ADMIN_P0 / SUPPORT(`.gitignore` +`.codegraph/`) / `.audit/`
- 无越界、无迁移、无 `prisma/schema.prisma`、无 lockfile
- 敏感扫描：无密钥/DSN/真实邮箱/内网 IP；无 `.env`/`.data/`/`.codegraph/` 误入
- 生成物：`pnpm contracts:check` exit 0（92 paths/203 schemas；23 endpoints/593 schemas fresh）；4 个删除的 `*Variants.ts` 零残留引用；`openapi.json` 新契约齐全

## Stage 2 — 静态审查 ✅
- 审计 UUID：`z.uuid()` 读放宽、DB/Prisma 仍 v7、无迁移改写、非法值被拒 → 通过；F4 `AdminAuditQuerySchema.actorId` 仍 v7（风险）
- 总览降级：单源降级 ✅ / auth 整页失败 ✅ / 0 值被门控 ✅ / refetch+degraded ✅ / 无 any·ts-ignore·空 catch·eslint-disable；缺口：`combineDashboardResources` 致命分支无直接单测、`isLoading` 用 `every`

## Stage 3 — 命令 ✅（含 2 个失败）
- contracts:check 0 / contracts typecheck 0 / contracts test 0 (52) / api·web·admin typecheck 0
- api spec 0 (4) / admin dashboard-view 0 (4) / admin build 0 / admin test 0 (44) / db test 0 (21)
- **web build 1**（F1 `packages/api-mocks/src/demo-content.ts:586` ZodError，Stop 新必填字段）
- **api test 1**（F2 8 failed/257 passed：`presentTrip`/`presentStop`/公开分享 payload 缺新必填字段 → create trip 500）
- PG：迁移 2 条应用 + 幂等 + status 干净；`admin-audit-uuid-compat.e2e-spec.ts` 1/1 通过（audit/export/metrics/emails 全 200，含 v4 id）；Prisma 新建 id 版本 nibble=7；v4 行回读 id 不变；非法 UUID 被 DB 拒
- 未跑：`admin-routes.e2e-spec.ts`、web/admin E2E、a11y、视觉、staging

## 漂移
- build/typegen 改写 `apps/{admin,web}/next-env.d.ts`（`.next/dev/types`→`.next/types`），未还原（禁 git checkout）
- PG 已 `pg_ctl stop -m fast`，数据目录 `.data/handoff-qa-20261118/pgdata`（51MB）保留

## Next
1. `W0_CONTRACTS` 补 API presenter + share-links payload + api-mocks 种子 → 复跑 web build 与 api test
2. 记录 F4/F5/F6 风险；提交前还原 next-env.d.ts
