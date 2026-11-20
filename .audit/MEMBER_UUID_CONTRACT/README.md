# MEMBER_UUID_CONTRACT evidence

Task: collapse the membership-uuid widening from a read-side local schema into
one contract rule, and make `PATCH`/`DELETE /members/:memberId` usable for the
two v4 rows that `MEMBERS_500` left behind.

## Contract change

`packages/contracts/src/entities/workspace.ts` — new exported
`MembershipRecordUuidSchema` (PostgreSQL `uuid` rule: 8-4-4-4-12 hex, any
version/variant), applied to `WorkspaceMemberSchema`
`id` / `workspaceId` / `userId` / `invitedById`. Regex, message and `describe`
text are byte-identical to the existing precedent `AuditRecordUuidSchema`
(`packages/contracts/src/entities/audit-log.ts:21-27`). Field set, `.strict()`
and nullability untouched.

`packages/contracts/src/api/common.ts` — `MemberParamsSchema.memberId` uses the
same schema (the schema lives in `api/common.ts`, which is why that one-line
import/cast is there); `workspaceId` stays `UuidV7Schema`.

`apps/api/src/modules/workspaces/workspace-presenter.ts` — local
`StoredUuidSchema` / `WorkspaceMemberWithUserReadSchema` deleted;
`presentMember` parses with the contract schema itself.

## Commands

```bash
# contract + unit
cd packages/contracts && node ../../node_modules/vitest/vitest.mjs run
cd apps/api && node ../../node_modules/vitest/vitest.mjs run src/modules/workspaces

# real PostgreSQL (roamlog_ci) + real HTTP through the Nest app
cd apps/api && ROAMLOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_ci?schema=public' \
  node ../../node_modules/vitest/vitest.mjs run test/workspace-members-uuid-compat.e2e-spec.ts

# live HTTP: isolated API on :4100 against roamlog_ci (the :4000 instance is untouched)
cd apps/api && API_PORT=4100 API_URL=http://127.0.0.1:4100 \
  DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_ci?schema=public' \
  node ../../node_modules/tsx/dist/cli.mjs src/main.ts
node .audit/MEMBER_UUID_CONTRACT/live-http-evidence.mjs

# drift this change introduces (openapi.json is the parent's to regenerate)
node node_modules/tsx/dist/cli.mjs packages/contracts/scripts/check-openapi.ts
```

## Results (fixed tree, 2026-11-20T19:41+08:00)

- `packages/contracts` full suite: **16 files / 186 tests passed**
  (including the new `src/__tests__/workspace-member-uuid.test.ts`, 9 tests)
- `apps/api src/modules/workspaces`: **3 files / 24 tests passed**
- `test/workspace-members-uuid-compat.e2e-spec.ts`: **6 passed**
- `tsc --noEmit` in `packages/contracts` and `apps/api`: no errors
- live HTTP evidence below

Live fixture shape: four memberships inserted as deterministic UUIDv7
(`deterministicId`), then exactly two `UPDATE`s rewrite their ids to the v4 ids
that actually broke `roamlog-crew` (`83a7562c-…`, `e7aa8557-…`).

### GET

```
GET /v1/workspaces/01942f30-…-009101/members -> 200
{"items":4,"hasMore":false,"members":[
 {"id":"01942f30-...-9201","role":"owner", ...},
 {"id":"01942f30-...-9202","role":"editor", ...},
 {"id":"83a7562c-4032-4de0-a33b-5ddc63b292ab","role":"viewer", ...},
 {"id":"e7aa8557-6e54-45f8-b8cf-b2735314cdce","role":"viewer", ...}]}
```

### PATCH a v4 row (role really changed in PostgreSQL)

```
PATCH /v1/workspaces/…/members/83a7562c-4032-4de0-a33b-5ddc63b292ab  { "role": "editor" }
-> 200 {"id":"83a7562c-4032-4de0-a33b-5ddc63b292ab","role":"editor","status":"active"}
db after PATCH: [{"id":"83a7562c-4032-4de0-a33b-5ddc63b292ab","role":"editor"}]
```

### DELETE another v4 row (row really gone)

```
DELETE /v1/workspaces/…/members/e7aa8557-6e54-45f8-b8cf-b2735314cdce
-> 200 {"message":"Member removed."}
db after DELETE: []
GET after DELETE: status 200 items 3
```

### Permission counter-proof (non-admin still 403, nothing written)

```
PATCH by editor  -> 403 {"code":"WORKSPACE_ROLE_FORBIDDEN", ...}
DELETE by editor -> 403 {"code":"WORKSPACE_ROLE_FORBIDDEN", ...}
db after forbidden calls: [{"id":"83a7562c-…","role":"editor"}]
```

### Format still enforced

```
PATCH /v1/workspaces/…/members/83a7562c40324de0a33b5ddc63b292ab (hyphenless)
-> 400 {"code":"VALIDATION_ERROR","errors":[{"field":"memberId","code":"INVALID_INPUT","message":"Invalid UUID"}]}
```

## OpenAPI drift this change causes (regenerate, do not hand-edit)

`WorkspaceMember` / `UpdateMemberResponse` uuid fields and the `memberId` path
param lose `format: "uuid"` and gain the PostgreSQL `pattern`, with the new
description; nullability is preserved (`invitedById` stays
`type: ["string","null"]`). `workspaceId` path params stay `format: uuid`
(UUIDv7). Unrelated drift in `check-openapi` output (`MediaPresignRequest.size`
maximum 26214400 → 1073741824) belongs to the concurrent upload-limits task.