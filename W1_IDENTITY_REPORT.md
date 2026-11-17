# W1-API-IDENTITY Delivery Report

状态: DONE_WITH_CONCERNS
任务 ID: W1-API-IDENTITY

## 变更文件

### Modified

- `apps/api/package.json`
- `apps/api/src/app.module.ts`
- `apps/api/src/config/environment.ts`
- `apps/api/src/config/app-config.service.ts`
- `apps/api/src/modules/audit/audit.module.ts`
- `apps/api/src/modules/audit/audit.service.ts`
- `apps/api/src/modules/auth/auth-options.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/__tests__/auth-options.spec.ts`
- `apps/api/scripts/bootstrap-admin.ts`
- `apps/api/src/modules/admin/admin.module.ts`
- `apps/api/src/modules/admin/admin-dashboard.controller.ts`
- `apps/api/src/modules/admin/admin-users.controller.ts`
- `apps/api/src/modules/admin/admin-workspaces.controller.ts`
- `apps/api/src/modules/admin/admin-content.controller.ts`
- `apps/api/src/modules/admin/admin-operations.controller.ts`
- `apps/api/src/modules/observability/http-logger.middleware.ts` (root-approved security exception)

### Created

- `apps/api/src/modules/auth/**`
- `apps/api/src/modules/users/**`
- `apps/api/src/modules/workspaces/**`
- `apps/api/src/modules/invitations/**`
- `apps/api/src/modules/admin/platform-two-factor.guard.ts`
- `apps/api/src/modules/admin/__tests__/platform-two-factor.guard.spec.ts`
- `apps/api/src/modules/audit/audit.controller.ts`
- `apps/api/src/modules/audit/__tests__/audit.service.spec.ts`
- `apps/api/src/config/app-config-two-factor.spec.ts`
- `apps/api/src/common/guards/**`
- `apps/api/src/common/services/**`
- `apps/api/src/common/__tests__/**`
- `apps/api/test/identity-fixtures.ts`
- `apps/api/test/identity-routes.e2e-spec.ts`
- `apps/api/test/http-logger-redaction.e2e-spec.ts`
- `apps/api/test/admin-two-factor.e2e-spec.ts`
- `apps/api/test/auth-two-factor.integration.e2e-spec.ts`

### Boundary confirmation

- W1 did not modify `packages/contracts`, `packages/db`, `apps/web`, `apps/admin`, `apps/worker`, prototype files, or root application configuration.
- Final working-tree verification showed only `apps/api/**` and `W1_IDENTITY_REPORT.md`; no `packages/**`, Web/Admin/Worker, lockfile, workspace, or root config files are changed by this task.
- `apps/api/src/modules/observability/http-logger.middleware.ts` is the only root-approved file outside the original W1 allowlist.
- `pnpm-lock.yaml` is integrator-owned and includes the combined Web/Admin/identity dependency graph; it has no current W1 diff.

## 实现摘要

- Better Auth 1.7.25 integration:
  - email/password with required email verification
  - Google and GitHub provider configuration from environment
  - verification and password-reset email callbacks
  - custom UUIDv7 ID generation for UUID database columns
  - DB-backed 7-day httpOnly same-site session cookies
  - session creation hook rejects unverified, suspended, or deleted users
  - verified TOTP enrollment, second-factor sign-in challenge, and disable flow
  - 6-digit / 30-second TOTP with account lockout controls
- `/v1/auth/*` Web Request bridge, `/v1/me`, `/v1/me/workspaces`, profile update, account deletion, session list/revoke.
- Workspace create/list/get/update/soft-delete and idempotent default-Workspace onboarding.
- Workspace member list, role/status update, remove, and transactional ownership transfer.
- Invitation create/list/revoke/accept with 7-day expiry, SHA-256 token hashes, pending uniqueness, expired-record rotation, delivery-failure revocation, and verified-email enforcement.
- Owner invariants:
  - new Workspace and onboarding always create exactly one Owner membership
  - only current Owner can transfer ownership
  - transfer demotes old Owner, promotes target, and updates `ownerId` in one serializable transaction
  - Admin cannot grant/modify Owner or grant Admin
  - Owner member removal is rejected
  - account deletion is rejected while the user owns an active Workspace
- `TenantGuard`, `RolesGuard`, `VerifiedEmailGuard`, `SessionGuard`, `PermissionService`, `WorkspaceAccessService`, and contract-backed request validation.
- `PlatformTwoFactorGuard` protects every `/v1/admin/*` controller. When `ADMIN_2FA_ENFORCED` is true, every non-`user` platform role must have an enabled and verified TOTP factor. The switch defaults to true in production and false in development/test.
- Bootstrap promotion requires `twoFactorEnabled=true`, a verified TOTP row, non-empty secret/backup codes, and no active lockout.
- Transactional audit writes for create/update/delete/onboarding/role/member/ownership/invitation/profile/session/account actions; tenant-scoped audit listing.
- Pino request-log redaction for all auth query values and invitation acceptance path tokens.
- SMTP (Mailpit/local) and Resend HTTP email delivery; email logs never persist message bodies or plaintext tokens.

## 新增依赖

- `better-auth@1.7.25`
- `nodemailer@10.6.0`
- `@types/nodemailer@8.0.2`

`pnpm-lock.yaml` also contains concurrent Web/Admin dependency resolution. Root owns the final clean-install integrity check and commit.

## 验证命令与结果

Final standard pnpm verification:

```text
pnpm --filter @roamlog/api test -- platform-two-factor bootstrap-two-factor auth-options app-config-two-factor admin-routes
Result: PASS — 5 files, 27 tests

pnpm --filter @roamlog/api typecheck
Result: PASS — `tsc --noEmit`, 0 errors

pnpm --filter @roamlog/api build
Result: PASS — `tsc -p tsconfig.build.json`, 0 errors

pnpm --filter @roamlog/api test
Result: PASS — 43 files passed / 1 skipped; 215 tests passed / 2 skipped

pnpm --filter @roamlog/api lint
Result: PASS — 0 errors

$env:ROAMLOG_TEST_DATABASE_URL='postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=public'; pnpm --filter @roamlog/api test
Result: PASS — 44 files, 217 tests, including the real PostgreSQL TOTP lifecycle

git diff --check
Result: PASS
```

Coverage includes TOTP enrollment, wrong-code rejection, successful verification, second-factor sign-in challenge, Admin guard unlock/lock, HTTP 403 before Admin handlers, TOTP disable, process-level bootstrap rejection without TOTP, `ADMIN_2FA_ENFORCED` defaults/overrides, the permission matrix, cross-Workspace UUID denial, Workspace CRUD/onboarding, member and Owner invariants, invitation expiry/revocation/rotation, unverified email gates, audit authorization, route wiring, and actual pino log emission.

### Runtime smoke (current built code)

```text
GET  /v1/health                                      -> 200
GET  /v1/auth/get-session                            -> 200, body null
GET  /v1/admin/metrics (unauthenticated)             -> 401
GET  /v1/me (unauthenticated)                        -> 401
GET  /v1/auth/verify-email?token=...&code=...        -> 401
POST /v1/invitations/<token>/accept (unauthenticated)-> 401
```

The smoke API was started with `DATABASE_URL` pointing at PostgreSQL `55432`, `ADMIN_2FA_ENFORCED=true`, and Better Auth schema validation enabled. Ports `3000` and `3001` remained listening throughout.

Emitted pino log assertions:

```json
{"AuthUrlRedacted":true,"InviteUrlRedacted":true,"AuthTokenLeaked":false,"OAuthSecretLeaked":false,"InviteTokenLeaked":false}
```

`http-logger-redaction.e2e-spec.ts` independently verifies the same invariant against a real pino HTTP stream.

## 未覆盖 / 风险

1. **Admin TOTP frontend is not implemented here.** API enrollment returns `totpURI` and backup codes, and second-factor challenge flows are proven; QR rendering, backup-code download, and Admin login recovery UX remain frontend work.
2. **Bootstrap account auto-creation is not implemented.** The design calls for creating the account and sending password/2FA setup mail when the email is absent. The current CLI fails explicitly with that requirement instead of pretending the user exists; existing-account promotion requires a verified TOTP factor.
3. **Real PostgreSQL coverage is focused on the 2FA lifecycle.** Signup, login, session persistence, 2FA enrollment/challenge/disable, and bootstrap rejection ran against PostgreSQL 55432. Google/GitHub OAuth exchanges and Mailpit/Resend provider delivery still require external credentials/services.
4. **OpenAPI conflict gaps remain contract-owned.** Current contracts do not document `409` for slug/member/invitation/account conflicts or `410` for expired/revoked invitations. Invitation creation intentionally returns no plaintext token; delivery is email-only.
5. **Role-change notifications are deferred to the Wave 2 notifications module.** Role changes and ownership transfer are audited in-transaction.
6. **Default onboarding runs on the first verified `GET /v1/me/workspaces`.** This was chosen because unverified accounts may not create Workspaces and the contracts have no onboarding endpoint.
7. **Better Auth rate limiting is in-process.** It enforces 10 requests/minute, but distributed Redis-backed rate-limit storage remains a hardening follow-up.
8. **Production must set/inspect `ADMIN_2FA_ENFORCED` at rollout.** The default is production `true` and development/test `false`; support, analyst, admin, and super_admin are all gated because the Admin console is platform-staff only.

## 建议下一步

1. Build the Admin/Web 2FA UX for QR enrollment, backup-code acknowledgement, challenge, and recovery.
2. Decide and implement the bootstrap missing-account creation mail flow, including safe one-time credentials/2FA enrollment.
3. Run external OAuth and Mailpit/Resend integration checks in staging.
4. Add the documented `409/410` error responses to contracts before Orval regeneration.
5. Add Redis-backed Better Auth rate-limit storage for multi-instance correctness.
6. Integrate Wave 2 role/member notifications and rerun the Admin forced-2FA journey end-to-end.
