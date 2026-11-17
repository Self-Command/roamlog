# W5 Live API E2E Report

Status: DONE

## Scope

Real API-mode browser tests using isolated Next runtimes, PostgreSQL schema `wave5_live_e2e`, Better Auth, TOTP, and a local Redis protocol stub.

## Results

- Full live suite: **8 passed** in 2.1 minutes.
- `live-setup`: unique verified Web user, TOTP Admin, pending Admin, outsider, workspace/trip fixtures.
- Web live journey: login → `/v1/me` → workspace → create trip → open detail → write journal entry → comment.
- Admin live journey: email login → TOTP challenge → metrics → suspend user → audit evidence.
- Admin gate: platform user without verified TOTP receives `ADMIN_2FA_REQUIRED`.
- API smoke:
  - `/v1/health` 200.
  - `/v1/ready` structured `200/503`; DB up, S3 intentionally down without MinIO.
  - unauthenticated Admin API 401.
  - cross-tenant trip lookup 404.
- The initial run exposed a Redis stub parser gap; inline RESP commands are now supported and the full suite passes.

## Commands

```bash
pnpm e2e:live
```

Artifacts are written under `playwright-report/live` and `test-results/live` (ignored).

## Residual Risks

- S3 readiness is degraded because the isolated suite does not start MinIO.
- The Redis stub implements the command surface needed by these flows, not full Redis semantics.
- OAuth callbacks, real Resend delivery, and production-scale load remain staging tasks.
