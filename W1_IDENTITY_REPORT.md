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
- `apps/api/src/modules/observability/http-logger.middleware.ts` (root-approved security exception)
- `pnpm-lock.yaml` (auto-updated dependency graph; integrator-owned)

### Created

- `apps/api/src/modules/auth/**`
- `apps/api/src/modules/users/**`
- `apps/api/src/modules/workspaces/**`
- `apps/api/src/modules/invitations/**`
- `apps/api/src/modules/audit/audit.controller.ts`
- `apps/api/src/modules/audit/__tests__/audit.service.spec.ts`
- `apps/api/src/common/guards/**`
- `apps/api/src/common/services/**`
- `apps/api/src/common/__tests__/**`
- `apps/api/test/identity-fixtures.ts`
- `apps/api/test/identity-routes.e2e-spec.ts`
- `apps/api/test/http-logger-redaction.e2e-spec.ts`

### Boundary confirmation

- W1 did not modify `packages/contracts`, `packages/db`, `apps/web`, `apps/admin`, `apps/worker`, prototype files, or root application configuration.
- Concurrent Web/Admin agents have separate dirty files in the shared worktree (including `pnpm-workspace.yaml` and `apps/admin/**`); those changes are not part of W1.
- `apps/api/src/modules/observability/http-logger.middleware.ts` is the only root-approved file outside the original W1 allowlist.
- `pnpm-lock.yaml` is integrator-owned and includes the combined Web/Admin/identity dependency graph.

## 实现摘要

- Better Auth 1.7.25 integration:
  - email/password with required email verification
  - Google and GitHub provider configuration from environment
  - verification and password-reset email callbacks
  - custom UUIDv7 ID generation for UUID database columns
  - DB-backed 7-day httpOnly same-site session cookies
  - session creation hook rejects unverified, suspended, or deleted users
  - structural 2FA plugin wiring
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
pnpm --filter @roamlog/api test -- permission tenant workspaces workspace-members invitations users audit auth-options identity-routes http-logger-redaction
Result: PASS — 10 identity test files, 67 tests

pnpm --filter @roamlog/api typecheck
Result: PASS — `tsc --noEmit`, 0 errors

pnpm --filter @roamlog/api build
Result: PASS — `tsc -p tsconfig.build.json`, 0 errors

pnpm --filter @roamlog/api test
Result: PASS — 16 test files, 83 tests

pnpm --filter @roamlog/api lint
Result: PASS — 0 errors

git diff --check
Result: PASS
```

Coverage includes the permission matrix, cross-Workspace UUID denial, workspace CRUD/onboarding, member role/suspend/remove, Admin/Owner restrictions, transactional Owner transfer, unique Owner removal rejection, invitation expiry/revocation/rotation/delivery failure, token hashing, list filters, unverified email gates, audit authorization, auth-option session gates, route wiring, and actual pino log emission.

### Runtime smoke (current built code)

```text
GET  /v1/health                                      -> 200
GET  /v1/auth/get-session                            -> 200, body null
GET  /v1/me (unauthenticated)                        -> 401
GET  /v1/auth/verify-email?token=...&code=...        -> 401
POST /v1/invitations/<token>/accept (unauthenticated)-> 401
```

Emitted pino log assertions:

```json
{"AuthUrlRedacted":true,"InviteUrlRedacted":true,"AuthTokenLeaked":false,"OAuthSecretLeaked":false,"InviteTokenLeaked":false}
```

`http-logger-redaction.e2e-spec.ts` independently verifies the same invariant against a real pino HTTP stream.

## 未覆盖 / 风险

1. **Functional 2FA remains deferred by root decision.** Better Auth 1.7.25 requires:
   - `User.twoFactorEnabled`
   - `TwoFactor.verified`
   - `TwoFactor.failedVerificationCount`
   - `TwoFactor.lockedUntil`
   The frozen Prisma schema has none of these. The plugin is structurally wired, and `advanced.database.validateSchema` is temporarily `false`; this should be re-enabled after the integrator-owned migration.
2. **No Docker/PostgreSQL runtime was available.** Live Better Auth signup/login, DB-backed sessions, OAuth callbacks, invitation persistence, and Mailpit/Resend delivery were not exercised end-to-end. The auth engine and GET session route were smoke-tested; all domain tests use injected mocks/fakes.
3. **OAuth provider credentials were not exercised.** Provider configuration and callback routing are wired, but real Google/GitHub exchanges require credentials and a public callback URL.
4. **OpenAPI conflict gaps remain contract-owned.** Current contracts do not document `409` for slug/member/invitation/account conflicts or `410` for expired/revoked invitations. Invitation creation intentionally returns no plaintext token; delivery is email-only.
5. **Role-change notifications are deferred to the Wave 2 notifications module.** Role changes and ownership transfer are audited in-transaction.
6. **Default onboarding runs on the first verified `GET /v1/me/workspaces`.** This was chosen because unverified accounts may not create Workspaces and the contracts have no onboarding endpoint.
7. **Better Auth rate limiting is in-process.** It enforces 10 requests/minute, but distributed Redis-backed rate-limit storage remains a hardening follow-up.

## 建议下一步

1. Integrator migration for the four 2FA fields, then enable schema validation and run live TOTP enrollment/verification.
2. Run the full auth flow against PostgreSQL + Mailpit: signup, verify, login, reset, invite, accept, revoke, suspend, transfer.
3. Add the documented `409/410` error responses to contracts before Orval regeneration.
4. Add Redis-backed Better Auth rate-limit storage for multi-instance correctness.
5. Integrate Wave 2 role/member notifications and verify admin forced-2FA gating.
