# Backup and restore

For the single-host production deployment at `https://we.spacedo.org`, use
[production-backup-restore.md](./production-backup-restore.md). It adds the
`docker/compose.server.yml` override, the env backup with mode `0600`, the
configurable retention job, and the isolated-restore procedure required for a
production drill. The commands below describe the local/staging compose stack.

## Data classes

| Store       | Authoritative?            | Required protection                                                            |
| ----------- | ------------------------- | ------------------------------------------------------------------------------ |
| PostgreSQL  | Yes                       | PITR where available, daily encrypted backups, pre-release snapshot            |
| S3/MinIO/R2 | Yes for media and exports | Bucket versioning or replicated backups, private access                        |
| Redis       | No                        | Rebuildable queue/cache state; AOF helps recovery but is not a database backup |
| Mailpit     | No                        | Ephemeral staging email capture                                                |
| Audit logs  | Yes                       | Retained in PostgreSQL; export for compliance where required                   |

Backups are not accepted until a restore has been tested. Keep backups encrypted
and outside the staging host.

## PostgreSQL backup

Before backup, confirm write traffic is quiesced or accept a higher recovery
point. For a consistent staging snapshot:

```bash
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "backups/roamlog-staging-$stamp.dump"
sha256sum "backups/roamlog-staging-$stamp.dump" \
  > "backups/roamlog-staging-$stamp.dump.sha256"
```

Store the dump, checksum, schema revision, and image tag together. Use the
provider's PITR for production; a `pg_dump` is not a substitute.

## PostgreSQL restore

Restore only into an isolated target first:

1. Stop API, worker, web, and admin to stop writes.
2. Create or select an empty restore database.
3. Verify the dump checksum.
4. Restore with `pg_restore`.
5. Run migrations only if the backup revision is older than the target release.
6. Start services and run readiness, login, admin, and media smoke tests.
7. Only then switch the application connection or accept the restored database.

Example restore into an empty database:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  exec -T postgres sh -lc \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl' \
  < "backups/roamlog-staging-$stamp.dump"
```

`--clean` is destructive. Apply it only after an explicit data-loss review and
only to the intended staging database.

## MinIO/S3 media backup

Use a separate bucket or filesystem target:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  run --rm -v "$PWD/backups:/backup" -e S3_ENDPOINT=http://minio:9000 \
  --entrypoint sh minio-init -lc \
  'mc alias set staging "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" && mc mirror --preserve "staging/$S3_BUCKET" "/backup/$S3_BUCKET"'
```

For the reverse direction, point the source at the mounted backup and the
destination at staging. Run it only during a reviewed recovery.

The restore direction is only for a reviewed recovery. Never make the bucket
public to simplify backup. For R2/S3, enable object versioning and lifecycle
rules, and verify that signed URLs and object keys still resolve after restore.

## Redis and queues

Redis is not a source of truth. After Redis loss:

1. Restart Redis.
2. Start API and worker.
3. Reconcile queued work from database state where the queue supports it.
4. Inspect failed/abandoned jobs and re-run only idempotent jobs.
5. Do not restore an AOF from another environment; queue prefixes and tenant
   state must remain isolated.

## Backup drill

Minimum staging drill:

1. Take a dump and media mirror.
2. Restore into a new database/bucket.
3. Run migrations and start a second API instance against the restore.
4. Verify `/v1/ready`, a member login, a private trip, an uploaded media object,
   audit visibility, and admin 2FA.
5. Record RPO, RTO, failed steps, and owner.
