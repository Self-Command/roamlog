# W0_DB checkpoint — Trip/Stop/place metadata migration

- repo: `C:\Users\BY9700\Desktop\UI\roamlog`
- task: W0_DB (data_worker), Wave 0 database slice
- CodeGraph: `codegraph status` -> `[OK] Index is up to date` (1,339 files / 19,718 nodes)
- git: only `.audit/` untracked (mine); others' dirty files are under `apps/**`, `packages/contracts/**`, `packages/api-client/**` — not touched.

## Spec read
- `.audit/2026-11-18-fullstack-gap-audit.md` 11.1 (the DB Wave 0 table; 11.2 is contracts).
- `docs/operations/migrations.md` (serial owner, deploy on empty + existing data, roll-forward).
- existing migration style: `0001_init` (Prisma-generated DDL + hand-written CHECKs), `0002_two_factor_state`.
- CHECK naming precedent: `"Trip_date_order_check"`, `"Stop_date_order_check"`, `"Expense_amount_nonnegative_check"`.

## Decisions
- migration dir `0003_w0_trip_stop_place_metadata` (sequential numeric prefix to match `0001_`/`0002_`; `<timestamp>` in task was a placeholder). Suffix `_w0_trip_stop_place_metadata` kept verbatim.
- all new columns nullable, no defaults -> same result on empty DB and existing rows (NULL).
- CHECK constraints validated immediately (data volume tiny; matches 0001 style), no NOT VALID two-step.
- Stop model re-aligned by `prisma format` (needed because `providerPlaceId` is wider than the old column); diff confined to Trip/Stop.
- Not adding the optional `Stop` composite index from audit 11.1 (not in this task's explicit field list) — reported as uncovered.

## Files
- M `packages/db/prisma/schema.prisma` (Trip +4 nullable, Stop +3 nullable)
- A `packages/db/prisma/migrations/0003_w0_trip_stop_place_metadata/migration.sql`
- A `packages/db/src/__tests__/migration.w0.test.ts`
- A `.audit/w0-db-report.md`

## Verification (real PG 17.11, port 55441, no Docker)
- [x] `pnpm --filter @roamlog/db test` (no URL): 26 passed / 6 skipped
- [x] `pnpm --filter @roamlog/db typecheck`: exit 0
- [x] `prisma validate`: valid
- [x] empty DB `pnpm db:migrate`: 0001+0002+0003 applied
- [x] columns/checks inspected in pg_catalog
- [x] existing-data DB: manual 0001+0002 -> `migrate resolve --applied` -> seed workspace/user/trip/stop -> `prisma migrate deploy` applied only 0003; legacy row retained, new columns NULL
- [x] negative cases (5) rejected with expected constraint names; valid write accepted
- [x] `migrate diff --from-config-datasource --to-schema`: "No difference detected."
- [x] full suite with `ROAMLOG_TEST_DATABASE_URL`: 32/32 passed
- [x] `pg_ctl stop -m fast`: server stopped, pgdata + pg.log retained
