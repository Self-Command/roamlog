# STG-FULL-CHAIN staging harness

This directory contains a repeatable local staging run that exercises the real
API, Redis ingress, BullMQ worker, PostgreSQL schema, MinIO, Mailpit, media
variants, signed reads, queued email, and seven-day ZIP exports.

## Run

```powershell
node tooling/scripts/staging-full-run.mjs
```

The script:

1. checks the existing MinIO, Mailpit, and Redis services, with at most one
   idempotent restart;
2. starts an isolated embedded PostgreSQL cluster on port `55439`;
3. creates a unique database and applies the real Prisma schema;
4. starts real API and Worker processes on an isolated Redis prefix;
5. creates an authenticated owner through Better Auth and seeds a trip;
6. exercises a failing media job, automatic BullMQ retry, sharp variants,
   blurhash persistence, and signed MinIO reads;
7. queues an Admin email resend and verifies the exact provider id in Mailpit;
8. creates a ZIP export, verifies idempotent replay, archive contents, signed
   download, private object access, and the exact seven-day TTL;
9. writes sanitized, timestamped evidence under `evidence/` and ignored runtime
   logs under `artifacts/`.

Optional environment variables:

| Variable                    | Default                              | Purpose                                |
| --------------------------- | ------------------------------------ | -------------------------------------- |
| `STAGING_FULL_API_PORT`     | `4300`                               | Isolated API port                      |
| `STAGING_FULL_PG_PORT`      | `55439`                              | Isolated embedded PostgreSQL port      |
| `ROAMLOG_PG_BIN`            | `.data/bootstrap-e2e/.../native/bin` | PostgreSQL binaries                    |
| `STAGING_FULL_KEEP_RUNTIME` | unset                                | Preserve the PostgreSQL data directory |
| `STAGING_FULL_KEEP_OBJECTS` | unset                                | Preserve MinIO test objects            |

Use `--keep-runtime` or `--keep-objects` instead of the environment variables
when invoking the script directly.

The run does not modify `.env.local`, does not stop ports `3000`/`3001`, and
does not use Resend or a real external mailbox.
