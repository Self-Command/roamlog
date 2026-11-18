# ADMIN_CRUD checkpoint

- Time: 2026-11-18 21:55 (+08:00)
- Task: admin users/workspaces detail, search, pagination, export (ADMIN_CRUD)
- Status: DONE (regeneration of OpenAPI/api-client is a root-owned follow-up)

## Delivered

1. Contracts (`packages/contracts/src/api/admin.ts`)
   - `AdminUserListItemSchema` (`activeSessionCount?`) drives `AdminUserPageSchema`.
   - `AdminUserDetailSchema`: optional `twoFactorEnabled`, `commentCount`, `mediaCount`,
     `workspaces[]`, `sessions[]`.
   - `AdminWorkspaceListItemSchema` (`owner?`, member/trip/entry/media counts + `mediaBytes?`)
     drives `AdminWorkspacePageSchema`.
   - `AdminWorkspaceDetailSchema`: optional `mediaCount`, `mediaBytes`, `members[]`, `invitations[]`.
   - New export query/CSV response schemas for users and Workspaces.

2. OpenAPI registration (`packages/contracts/scripts/openapi/paths-admin.ts`, outside the literal
   file list but required for the export endpoints to appear in the OpenAPI document)
   - `GET /v1/admin/users/export` -> `exportAdminUsersCsv`.
   - `GET /v1/admin/workspaces/export` -> `exportAdminWorkspacesCsv`.
   - `contracts:check` now reports only expected drift (new fields/paths); regeneration still required.

3. API (`apps/api/src/modules/admin`)
   - User list: server search name/email/Workspace name/slug, role/status filters, cursor page,
     active session counts.
   - User detail: real counts (workspace/trip/entry/comment/media/session), 2FA, Workspace
     memberships with role/status, active sessions.
   - Workspace list: server search/status/plan, owner, member/trip/entry/media counts, media bytes.
   - Workspace detail: members with roles, invitations, media count/bytes.
   - Streaming CSV exports with BOM, CRLF, formula-injection guard, 50k cap, headers only after
     first validated chunk; gated by `admin:users:delete` / `admin:workspaces:delete`.
   - New `admin-csv.ts`.

4. Admin
   - `admin-data-source.ts`: typed contract fetch hooks for paged users/workspaces, detail, recent
     trips; export URL/download helpers; preview CSV builder; page resources are a 1-row gate.
   - Users view: server search/status/role/sort, debounced query, cursor paging, sessionStorage
     filter persistence (sort/status/role/q), real detail counters/memberships/sessions/2FA,
     server CSV export (admin+), preview CSV in fixture mode, retries/error branches.
   - Workspaces view: server search/status/plan/sort, paging, real list metrics/owner/media bytes,
     detail members/invitations/recent trips/storage, plan change and ownership transfer via real
     PATCH with confirmation/errors, server CSV export (admin+).

## Tests / verification

- `pnpm --filter @roamlog/contracts typecheck` -> pass; `contracts:check` -> expected drift list.
- `pnpm --filter @roamlog/admin typecheck` -> pass.
- `pnpm --filter @roamlog/admin test` -> 16 files / 64 tests pass.
- `pnpm --filter @roamlog/api exec vitest run src/modules/admin` -> 10 files / 72 tests pass.
- `pnpm --filter @roamlog/api exec vitest run test/admin-routes.e2e-spec.ts` -> 26 tests pass
  (export 200 headers, 401, 403, route not shadowed).
- `pnpm --filter @roamlog/api typecheck` -> only in-flight parallel errors in
  `src/modules/media/__tests__/trip-cover-projection.spec.ts` and
  `src/modules/trips/__tests__/trips-origin-location.spec.ts`; no admin errors.

## Root follow-ups

- Run `contracts:generate` then `api-client:generate`; re-run `contracts:check`/`api-client:check`.
- Optional: switch admin pages to generated hooks once available (currently contract-typed fetch).
- Validation failures are 400 `VALIDATION_ERROR` per global convention, not 422.
- `DestructiveActionDialog` still contains the out-of-scope fake hint "当前没有连接真实 API".
- Bulk actions are Promise.all and can partially succeed on network failure.
- CSV exports are not audit-logged.