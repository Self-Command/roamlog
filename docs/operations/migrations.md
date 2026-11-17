# Database migrations

## Ownership and rules

- Only the database owner or release operator generates Prisma migrations.
- A migration is serialised: one writer, one deploy at a time. Do not start
  multiple `prisma migrate deploy` processes concurrently.
- Never use `prisma migrate reset`, `db push`, or manual DDL against staging or
  production to bypass the migration history.
- Roll forward for data changes whenever possible. A down migration is not
  assumed to be safe unless it is explicitly reviewed and tested.

## Preconditions

1. Confirm the target environment and database hostname.
2. Confirm the current API/worker image tag and previous known-good tag.
3. Take a PostgreSQL backup before any migration that can rewrite or delete data.
4. Check `prisma migrate status` and repository drift.
5. Confirm the migration has passed on an empty database and a copy of current
   staging data.
6. Schedule a maintenance window for migrations with table rewrites, long locks,
   or destructive changes.

## Migration status

Inside the migration image:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm --entrypoint sh migrate -lc \
  'cd /app/node_modules/@roamlog/db && prisma migrate status'
```

The expected output is that all migrations are applied and the schema is up to
date. Any pending migration must be applied by the release job, not by an
interactive request.

## Apply to an empty staging database

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app up -d postgres redis minio mailpit minio-init
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm migrate
```

The compose `migrate` service uses the pinned Prisma CLI and the `DATABASE_URL`
from the staging environment. It runs exactly `prisma migrate deploy`.

## Apply to an existing staging database

1. Stop application writes:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app stop api worker web admin
```

2. Back up PostgreSQL. See [backup-restore.md](./backup-restore.md).
3. Run the migration job:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm migrate
```

4. Start API/worker and wait for readiness:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app up -d api worker web admin
curl -fsS https://api.staging.roamlog.app/v1/ready
```

5. Run the smoke and role checks from
   [staging-deployment.md](./staging-deployment.md).

## Migration failure

- Do not rerun `migrate deploy` repeatedly while the migration table is in an
  inconsistent state.
- Preserve the migration job output and database logs.
- Determine whether the failure occurred before a committed transaction, during
  a partial DDL statement, or after a successful commit but failed post-check.
- If the schema is partially changed and the release cannot safely roll forward,
  restore the pre-migration backup and roll back the application image.
- Do not delete a failed migration record manually without an explicit recovery
  procedure.

## Existing-data checks

For each release, verify:

- migrations are ordered and immutable after merge;
- no migration deletes user data without a backup and product approval;
- defaults and `NOT NULL` additions work on existing rows;
- long-running indexes use the agreed online strategy where applicable;
- seed is not called by the migration job;
- worker does not start against an older schema than API.

## Post-migration evidence

Archive:

- migration image tag and digest;
- `prisma migrate status` output;
- migration job logs;
- backup location and checksum;
- `/v1/ready` response;
- API/worker startup logs;
- smoke test results.
