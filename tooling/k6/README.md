# Roamlog k6 staging gates

These scripts are the load/security gate harness for Roamlog staging.

## Status in this workspace

The official Windows binary is available at
`tooling/k6/runtime/k6-v2.4.0-windows-amd64/k6.exe`. The `runtime/` directory is
ignored by Git. The release-gate run on 2026-11-17 executed both scripts against
an isolated API backed by real PostgreSQL, Redis, MinIO, and Mailpit.

For a reproducible run, use:

```powershell
pwsh -NoProfile -File tooling/k6/run-staging-release.ps1
```

The script provisions an isolated schema and fixture, starts API port `4100`,
verifies Mailpit delivery, executes both k6 gates, writes summaries under
`test-results/staging-release/k6/`, and stops only the API process it owns.

## Required inputs

Set these environment variables before running:

```text
API_BASE_URL
ROAMLOG_SESSION_COOKIE
ROAMLOG_WORKSPACE_ID
ROAMLOG_TRIP_ID
ROAMLOG_SHARE_TOKEN (optional; setup creates one when omitted)
ROAMLOG_PASSWORD_SHARE_TOKEN
ROAMLOG_WEB_ORIGIN
```

## Commands

```powershell
tooling/k6/runtime/k6-v2.4.0-windows-amd64/k6.exe run `
  --summary-export test-results/staging-release/k6/staging-smoke-summary.json `
  tooling/k6/staging-smoke.js

tooling/k6/runtime/k6-v2.4.0-windows-amd64/k6.exe run `
  --summary-export test-results/staging-release/k6/staging-security-summary.json `
  tooling/k6/staging-security.js
```

`staging-smoke.js` covers `/v1/health`, unauthenticated Admin denial,
authenticated Workspaces/Trips reads, and public share reads with p95 and error
rate thresholds. `staging-security.js` asserts auth, share-token enumeration,
share-password, and upload-presign rate limiting. With `TRUST_PROXY=true`, the
smoke script assigns a synthetic per-iteration `X-Forwarded-For` to public-share
reads so the normal 60/min client limit does not turn the load test into a
single-client abuse test. The security script intentionally keeps one synthetic
IP per abuse scenario so it can assert the production thresholds.

Artifacts are written under `test-results/staging-release/k6/`, which is
ignored by Git.
