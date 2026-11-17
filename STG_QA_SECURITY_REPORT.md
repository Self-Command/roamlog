# STG-QA-SECURITY Report

Status: **CHANGES_REQUESTED**

Date: 2026-11-17 (Asia/Shanghai)

## 1. Environment and scope

This run used the same isolation pattern as `pnpm e2e:live`, but with a separate
staging schema and ports:

- API: `http://127.0.0.1:4100`
- Web: `http://127.0.0.1:3100`
- PostgreSQL: `localhost:55432`, schema `staging_security_e2e`
- Redis: local protocol stub on `127.0.0.1:46382`
- Browser: Playwright Chromium, 1440 and 390 viewports
- Production header/cookie check: separate API on `4200`, `NODE_ENV=production`,
  HTTPS app/API origins, same isolated schema
- Previews on `3000` and `3001` stayed running throughout and were not stopped

This is a local isolated staging harness, **not** a real staging deployment.
MinIO, Mailpit, real Redis, real Resend delivery, OAuth credentials, and TLS
termination were not available.

## 2. Results summary

| Gate                                              | Result             | Evidence                                                                                                 |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| Staging setup and 4100 API                        | PASS               | `.e2e-live/staging-fixture.json` created during run                                                      |
| Real UI -> API trip journey                       | PASS               | `test-results/staging/journey-trip-desktop.png`, `journey-trip-mobile.png`                               |
| Anonymous public share                            | PASS               | `public-share-desktop.png`, `public-share-mobile.png`; no emails/comments rendered                       |
| Share password wrong/correct                      | PASS               | `public-share-password.png`; wrong -> 401, correct -> content                                            |
| Expired/revoked share                             | PASS               | both return `SHARE_LINK_NOT_FOUND` 404; `share-unavailable-expired.png`, `share-unavailable-revoked.png` |
| Cross-tenant IDOR (get/patch/share)               | PASS               | 404 for all three attempts                                                                               |
| CSP / X-Frame-Options / Referrer-Policy / nosniff | PASS               | `test-results/staging/evidence/http-headers.json`                                                        |
| Production HSTS                                   | PASS               | `production-headers.json`, `max-age=31536000; includeSubDomains`                                         |
| Cookie HttpOnly / SameSite / Secure               | PASS               | test: HttpOnly + SameSite=Lax; production: `__Secure-` + `Secure`                                        |
| CORS allowlist                                    | PASS               | allowed origin gets ACAO/credentials; evil origin gets no ACAO                                           |
| Share token enumeration                           | PASS (unguessable) | 64/64 random tokens -> 404; no token oracle                                                              |
| Share expiry/revocation/password semantics        | PASS               | 404/404/401 as above                                                                                     |
| Upload MIME/size/SSRF-input validation            | PASS               | MIME 400, 25MB+1 400, URL field 400; traversal filename sanitized                                        |
| Auth brute-force throttle                         | PASS               | first 401, subsequent 11 -> 429                                                                          |
| Share read/password/upload throttles              | **FAIL**           | no 429 in 80 / 20 / 20 requests                                                                          |
| Normal session reads not throttled                | **FAIL**           | production get-session 200 x10, then 429 on request 11                                                   |
| CSRF/Origin enforcement on custom writes          | **FAIL**           | evil Origin accepted; production write returned 201                                                      |
| Better Auth Origin rejection                      | PARTIAL            | production 403; staging `NODE_ENV=test` returned 200                                                     |
| k6 real load summary                              | **NOT EXECUTED**   | `k6 binary unavailable`; scripts syntax-checked only                                                     |

Final Playwright run: **9 passed, 2 failed** (52.1s), exit code 1.
The two failed tests are the intentional security gates above; the harness and
functional journeys passed. Full log: `test-results/staging/final-run.log`.

## 3. Real executed commands

```powershell
pnpm e2e:staging
# 9 passed, 2 failed, exit code 1

pnpm exec tsc -p e2e/staging/tsconfig.json
# exit code 0

pnpm typecheck
# 11/11 packages successful

pnpm k6:staging:check
# Node syntax check passed for both k6 scripts

pwsh -File e2e/staging/verify-production-headers.ps1
# production HSTS/cookie/Origin checks; writes production-headers.json
```

`Get-Command k6` returned no executable. Per the current task instruction, no
binary was downloaded. Therefore no k6 JSON summary exists. The complete
scripts are `tooling/k6/staging-smoke.js` and
`tooling/k6/staging-security.js`, with usage in `tooling/k6/README.md`.
Expected output paths once k6 is available:

- `tooling/k6/artifacts/staging-smoke-summary.json`
- `tooling/k6/artifacts/staging-security-summary.json`

## 4. Security findings and precise reproduction

### STG-SEC-001 — P1 — `/v1/auth/get-session` is rate limited during normal navigation

Production-mode API, fresh process, no prior browser traffic:

```text
GET /v1/auth/get-session (x15, same IP)
200 x10
429 x5  (first 429 at request 11)
```

Playwright also observed this during ordinary password/share page loads:

```text
Failed to load resource: the server responded with a status of 429
http://127.0.0.1:3100/v1/auth/get-session
```

This is a Better Auth global `rateLimit` of 10 requests/60s per IP, applied to
the session read endpoint. Users behind NAT, shared offices, or a test runner
can lose session hydration after ten page loads. The UI then logs console
errors and may show an unauthenticated state.

Evidence: `test-results/staging/evidence/production-headers.json`,
`test-results/staging/evidence/rate-limit-probes.json`,
`test-results/staging/final-run.log`.

Minimal fix: exclude `get-session` from the mutation throttle or give it a
separate per-session/per-device limit; keep the strict limit on sign-in,
sign-up, password reset, and 2FA endpoints. Return `Retry-After` on 429.

### STG-SEC-002 — P1 — Share reads, share passwords, and upload presign are not throttled

Real request bursts:

```text
GET  /v1/public/trips/{random-token} x80   -> 404 x80, no 429
GET  /v1/public/trips/{password-token}?password=wrong-x20 -> 401 x20, no 429
POST /v1/workspaces/{id}/media/presign x20 -> 201 x20, no 429
```

The auth sign-in path did return 429 after ten attempts, proving the runtime
has throttling available; the share and upload routes simply do not use it.

Impact: unlimited share-password guessing (only scrypt cost slows it), token
enumeration probing, and authenticated presign/DB-row abuse. Although share
tokens are 32 random bytes and not practically enumerable, the §8.3/§21.6
rate-limit gate is not met.

Evidence: `rate-limit-probes.json`.

Minimal fix: add a Nest throttler backed by Redis with route-specific guards:

- public share read: IP + token, e.g. 60/min
- share password verification: IP + token, e.g. 5/min and 20/hour
- media presign: user + workspace, e.g. 30/min
- auth mutation: keep 10/min/IP plus account lockout
- return Problem Details/429 and `Retry-After`

### STG-SEC-003 — P1/P2 — Custom authenticated writes accept a disallowed Origin

Production-mode API, valid session, `Origin: https://evil.example`:

```text
POST /v1/workspaces/{workspaceId}/trips -> 201
DELETE /v1/trips/{tripId}               -> 200 (probe cleanup)
```

In the staging test config, the same probe returned 400 only because the body
was intentionally invalid; the error was `VALIDATION_ERROR`, not an Origin
rejection. In production, a valid body was accepted.

Evidence: `production-headers.json`, `csrf-probe.json`.

§8.3 requires custom write endpoints to validate Origin/CORS allowlist.
`SameSite=Lax` prevents a normal cross-site form POST from carrying the session
cookie, and CORS prevents JavaScript from reading the response, so routine
cross-site browser CSRF is constrained. The server-side invariant is still
missing, and login-CSRF/misconfigured deployments/XSS remain relevant.

Minimal fix: add a global `OriginGuard` for non-GET `/v1/*` routes (except
Better Auth, which already validates in production). Allow only
`CORS_ORIGINS`/same-origin/API-to-API patterns; reject with 403
`CSRF_ORIGIN_REJECTED`. Add a contract test with evil `Origin`.

### STG-SEC-004 — P2 — Better Auth Origin behavior differs between test and production

Staging `NODE_ENV=test`:

```text
POST /v1/auth/sign-in/email, Origin: https://evil.example -> 200
```

Production-mode:

```text
POST /v1/auth/sign-in/email, Origin: http://127.0.0.1:3100 -> 403
```

Production correctly rejects an untrusted Origin. The test/staging config
accepting it means a release can pass CSRF tests that production would fail or
hide a regression. Root cause is not yet determined; investigate Better Auth
`trustedOrigins`/test-mode behavior before relying on test-mode auth CSRF
coverage.

Evidence: `csrf-probe.json`, `production-headers.json`.

### STG-SEC-005 — P2 — Creating a trip without optional `origin` returns 500

Reproduction against the isolated API with a valid owner session:

```http
POST /v1/workspaces/{workspaceId}/trips
{
  "title": "Production CSRF probe",
  "startDate": "2027-08-01",
  "endDate": "2027-08-02"
}
```

Observed: HTTP 500, `INTERNAL_SERVER_ERROR`.
Server log: `ZodError` at `presentTrip` for `origin` requiring at least one
character. `CreateTripRequestSchema.origin` is optional and the service stores
`""` when omitted, but `TripSchema.origin` requires `.min(1)`.

Minimal fix: make the create default a non-empty value (e.g. `"未填写"`), or
allow an empty origin in `TripSchema`/`presentTrip` and render it as unspecified.
Add a contract test for omitting `origin`.

### STG-SEC-006 — P3 — Disallowed CORS preflight returns 404, not 403

Allowed preflight -> 204 with ACAO/credentials. Disallowed preflight -> 404
with no ACAO. The browser still blocks the request, so this is not an
allowlist bypass, but 403/Problem Details is clearer and easier to assert.

## 5. Passed security checks

- `Content-Security-Policy`: `default-src 'none'`, `frame-ancestors 'none'`,
  `form-action 'none'`, `script-src 'self'`; no inline script allowance.
- `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-site`.
- Production HSTS: `max-age=31536000; includeSubDomains`.
- Cookie: test mode `HttpOnly; SameSite=Lax; Path=/`; production
  `__Secure-roamlog.session_token; HttpOnly; Secure; SameSite=Lax`.
- CORS: configured web/admin origins receive credentials/headers; evil origin
  receives no ACAO.
- Cross-tenant IDOR: GET, PATCH, and share-link creation on an outsider trip
  all return 404, with no tenant data in the response.
- Share token: 64 random tokens all 404; missing password -> 401
  `SHARE_PASSWORD_REQUIRED`; wrong password -> 401
  `SHARE_PASSWORD_INVALID`; expired and revoked -> 404
  `SHARE_LINK_NOT_FOUND`.
- Media presign: `application/pdf` -> 400; 25MB + 1 -> 400; `sourceUrl` SSRF
  field -> 400; `../../../etc/passwd.png` sanitized and presign still uses the
  S3 endpoint, not the filename.
- Real UI journey: login -> `/v1/me` -> trips -> create trip -> open detail ->
  API read-back; passed with 0 unexpected console errors and no horizontal
  overflow at 390px.
- Public share page: real content, mobile/desktop screenshots, no comment/email
  leakage, 0 unexpected console errors on success paths.

## 6. Not executed / coverage gaps

- **k6 load execution**: binary unavailable; no p95/RPS/error-rate result.
  Scripts are complete and syntax-checked but unexecuted.
- **Real staging infrastructure**: no real Redis, MinIO/S3, Mailpit/Resend,
  OAuth credentials, TLS termination, or staging DNS. Local Redis stub and no
  MinIO mean `/v1/ready` is not a production readiness proof.
- **Upload magic-byte verification**: API presign rejects declared MIME/size,
  and worker code contains magic-byte checks, but no actual object upload +
  worker processing was executed without S3/MinIO.
- **CSRF browser exploit**: direct server requests prove missing Origin
  enforcement; a real cross-site browser exploit was not attempted. SameSite
  and CORS are documented as mitigations, not substitutes.
- **Viewer/Editor permission matrix**: only cross-tenant 404 was exercised in
  this staging layer; existing unit/integration tests remain the source.
- **TLS handshake/HSTS browser enforcement**: production API returned the HSTS
  header, but no HTTPS endpoint existed to observe browser HSTS behavior.
- **Admin staging journey**: existing live E2E covers admin 2FA, but this
  staging run did not start the admin app.

## 7. Evidence index

- `test-results/staging/evidence/http-headers.json`
- `test-results/staging/evidence/production-headers.json`
- `test-results/staging/evidence/csrf-probe.json`
- `test-results/staging/evidence/rate-limit-probes.json`
- `test-results/staging/evidence/share-and-media-gates.json`
- `test-results/staging/journey-trip-desktop.png`
- `test-results/staging/journey-trip-mobile.png`
- `test-results/staging/public-share-desktop.png`
- `test-results/staging/public-share-mobile.png`
- `test-results/staging/public-share-password.png`
- `test-results/staging/share-unavailable-expired.png`
- `test-results/staging/share-unavailable-revoked.png`
- `test-results/staging/final-run.log`
- `test-results/staging/playwright/` (failure traces/screenshots)
- `playwright-report/staging/` (HTML report)

## 8. Files changed by this task

- `playwright.staging.config.ts`
- `e2e/staging/**`
- `tooling/k6/**`
- `.gitignore` (k6 binaries/artifacts)
- `package.json` — this task added only `e2e:staging`, `k6:staging:smoke`,
  `k6:staging:security`, and `k6:staging:check`; no dependency or lockfile
  change. The same file also contains concurrent edits from another agent
  (`staging:validate`, `staging:config`, `admin:bootstrap`), which this task
  did not author or modify.
- `STG_QA_SECURITY_REPORT.md`

No product code, contracts, database schema/migrations, or root lockfile were
modified. The workspace also contains unrelated concurrent changes under
`.github/`, `docker/`, `apps/api/scripts/`, and `tooling/services/`; they are
outside this task and were not touched by this agent.

## 9. Verdict

**CHANGES_REQUESTED.** The real-API journey, public sharing, header baseline,
tenant isolation, share lifecycle, upload input validation, and auth throttling
pass. Release readiness is blocked by:

1. 429 on normal `/v1/auth/get-session` reads.
2. No throttling for share reads, share passwords, or upload presign.
3. No server-side Origin enforcement on custom writes.
4. Staging/test vs production Better Auth Origin inconsistency.
5. Optional-origin trip creation returning 500.

After fixes, rerun `pnpm e2e:staging` and run the k6 scripts on real staging
with PostgreSQL/Redis/MinIO available; attach the two k6 summary JSON files.
