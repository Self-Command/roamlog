# MEMBERS_500 evidence

`GET /v1/workspaces/:id/members` answered `500 INTERNAL_SERVER_ERROR` for
`roamlog-crew` (`019b7946-1c12-72e5-b2f5-ba152dee90d6`) while the verify owner's
own workspace (`01a1f7a6-a01e-748b-ae6b-930248ec02a6`) answered 200.

## Root cause

Two `WorkspaceMember` rows in that workspace carry a v4 UUID
(`83a7562c-4032-4de0-a33b-5ddc63b292ab`, `e7aa8557-6e54-45f8-b8cf-b2735314cdce`);
a fixture script inserted them with `randomUUID()`. PostgreSQL stores either
version in a `uuid` column, but `WorkspaceMemberWithUserSchema` pins `id` to
`UuidV7Schema`, so `presentMember` threw:

```
ZodError: [ { "code": "invalid_format", "format": "uuid",
  "path": ["id"], "message": "Invalid UUID" } ]
    at presentMember (apps/api/src/modules/workspaces/workspace-presenter.ts:100:40)
```

`list()` validates every row through `toCursorPage(..., (record) => presentMember(record))`.

## Commands

```bash
# DB shape (pg 8.23.1 from the pnpm store, no psql on PATH)
node .audit/MEMBERS_500/inspect-members.mjs
node .audit/MEMBERS_500/inspect-ids.mjs

# API with the fixed code (never touch the :4000 instance)
cd apps/api && API_PORT=4100 API_URL=http://127.0.0.1:4100 LOG_LEVEL=info \
  DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public' \
  node ../../node_modules/tsx/dist/cli.mjs src/main.ts

# HTTP evidence (origin must be http://localhost:3000; 127.0.0.1 is 403)
API_BASE=http://127.0.0.1:4100 node .audit/MEMBERS_500/http-evidence.mjs
API_BASE=http://127.0.0.1:4100 node .audit/MEMBERS_500/http-matrix.mjs

# Regression tests
cd apps/api
node ../../node_modules/vitest/vitest.mjs run src/modules/workspaces
ROAMLOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_ci?schema=public' \
  node ../../node_modules/vitest/vitest.mjs run test/workspace-members-uuid-compat.e2e-spec.ts
```

## Result

Before (same code, before the presenter fix): both URLs `500` with
`{"code":"INTERNAL_SERVER_ERROR"}`.
After: `200`, `items: 5`, including both legacy-id members; `?limit=24` also `200`.
Matrix of 10 query variants (limit/sort/role/status/q) all `200`.