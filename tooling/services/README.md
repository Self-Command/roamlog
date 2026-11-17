# Roamlog staging services

This directory provides Docker-free Windows services for local staging checks.
Runtime downloads, logs, data, and PID files remain under `runtime/` and are
ignored by Git.

```powershell
pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action start
pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action status
pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action stop
pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action clean
```

`start` is idempotent, waits for real health checks, creates the private
`roamlog-local` and `roamlog-test` buckets, and starts MinIO with a loopback-only
CORS allowlist through `MINIO_API_CORS_ALLOW_ORIGIN`. MinIO does not implement
bucket-level CORS, so the bucket bootstrap reports that as a warning. MinIO is
built from the pinned community source tag `RELEASE.2025-09-07T16-13-09Z`
because current AIStor binaries reject every S3 operation without a license.

Ports and credentials are read from the process environment first and then
from the repository `.env.local`. Defaults match the Roamlog local contract:

| Service             | Ports           |
| ------------------- | --------------- |
| MinIO API / console | `9000` / `9001` |
| Mailpit SMTP / HTTP | `1025` / `8025` |
| Redis               | `6379`          |

All three services bind `127.0.0.1` only. Redis has no password in this local
profile; do not expose these ports or reuse the default credentials on a shared
host or in staging/production.

Set `ROAMLOG_STAGING_SERVICES=1`, `ROAMLOG_TEST_REDIS_URL`, and the Mailpit
URLs when running the opt-in integration suites.
