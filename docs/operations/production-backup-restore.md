# Production backup and restore

This runbook is for the single-host deployment at `https://we.spacedo.org`.
The repository copy of the backup tool is `deploy/backup-roamlog.sh`; install it
at `/opt/roamlog/bin/backup-roamlog.sh`.

The backup set contains:

- a PostgreSQL custom-format dump;
- a mirror of the private S3/MinIO bucket;
- a copy of `/opt/roamlog/config/.env.production`;
- a manifest and SHA-256 checksums.

The env file is included because an application restore is incomplete without
its runtime configuration. It contains secrets. Backups are therefore created
with the run directory mode `0700`, every file mode `0600`, and must be copied
to encrypted, access-controlled storage outside the host. Never print, paste,
or attach the env backup.

## Prerequisites

- The deployment stack is running, including `postgres` and `minio`.
- Docker Compose can read `/opt/roamlog/config/.env.production` and
  `/opt/roamlog/repo/docker/compose.production.yml`.
- The operator has root access, or an approved equivalent that can read the env
  file without exposing it to another account.
- There is enough free space for a full object-store mirror plus the PostgreSQL
  dump. A full first backup can be much larger than later backups because the
  mirror is written into a new timestamped directory each time.

## Install the backup job

```bash
sudo install -d -m 700 /opt/roamlog/bin
sudo install -m 700 /opt/roamlog/repo/deploy/backup-roamlog.sh \
  /opt/roamlog/bin/backup-roamlog.sh
```

Run one backup manually before scheduling it:

```bash
sudo BACKUP_RETENTION_DAYS=14 /opt/roamlog/bin/backup-roamlog.sh
```

The defaults are:

| Variable                | Default                            | Purpose                                              |
| ----------------------- | ---------------------------------- | ---------------------------------------------------- |
| `BACKUP_ROOT`           | `/opt/roamlog/backups`             | Parent directory for timestamped runs                |
| `BACKUP_RETENTION_DAYS` | `14`                               | Delete only completed runs older than this many days |
| `ROAMLOG_REPO_DIR`      | `/opt/roamlog/repo`                | Checkout containing the compose files                |
| `ROAMLOG_COMPOSE_FILE`  | `<repo>/docker/compose.production.yml` | Production Compose file                          |
| `ROAMLOG_ENV_FILE`      | `/opt/roamlog/config/.env.production`  | Compose env and env backup source               |
| `ROAMLOG_COMPOSE_PROJECT_NAME` | `roamlog`                    | Docker Compose project name                         |
| `BACKUP_MC_IMAGE`       | pinned `chainguard/minio-client` image | Shell-free MinIO client used only for backup   |
| `BACKUP_MC_HOST`        | derived from `S3_*` values          | Optional pre-encoded `MC_HOST` alias            |

The standard Compose overrides `COMPOSE_FILE` (colon-separated file list),
`COMPOSE_ENV_FILE`, and `COMPOSE_PROJECT_NAME` are also supported. The
production defaults match `docker/compose.production.yml` and the operator env
file used by the deployed containers.

The backup deliberately runs the pinned MinIO client image directly instead of
the `minio-init` service. That keeps backups independent of the bucket
bootstrap image and avoids provider-registry availability becoming a backup
outage.

The script does not modify cron or systemd. Schedule it only after operational
approval and ensure the scheduler runs it as root. A successful run ends with a
`COMPLETE` file; an incomplete run is left in place for inspection and is not
pruned automatically.

## Verify a backup

The script prints the run directory and size only. Inspect the metadata and
checksums without opening `env`:

```bash
backup=/opt/roamlog/backups/roamlog-YYYYMMDDTHHMMSSZ
sudo chmod 600 "$backup/COMPLETE"
(cd "$backup" && sudo sha256sum -c SHA256SUMS)
sudo test -s "$backup/postgres.dump"
sudo test -s "$backup/env"
sudo docker exec -i roamlog-postgres-1 pg_restore --list < "$backup/postgres.dump" >/dev/null
sudo find "$backup" -type f -printf '%m %p\n' | sort
```

Expected: `SHA256SUMS` reports `OK` for every file and every listed file has
mode `600`. A backup is not accepted for release evidence until at least a
restore drill into an isolated target has passed.

## Restore policy

Never use a production backup as the first restore attempt. Restore into an
isolated database and bucket, run migrations and smoke checks there, then obtain
explicit approval for an in-place recovery.

For an in-place restore:

1. Declare the incident and stop API, worker, web, and admin writes.
2. Take a safety backup of the current production state before changing it.
3. Confirm the release tag, migration version, backup checksum, and affected
   tenants.
4. Restore PostgreSQL and object storage.
5. Start the API first and verify `/v1/ready`; then start worker, web, and admin.
6. Run the production smoke checklist and preserve command output and logs.

## Restore PostgreSQL into an isolated database

The compose command must be the production command used by the app:

```bash
compose() {
  docker compose \
    --project-directory /opt/roamlog/repo \
    --project-name roamlog \
    --env-file /opt/roamlog/config/.env.production \
    -f /opt/roamlog/repo/docker/compose.production.yml \
    --profile init "$@"
}
```

Create a restore database and restore the dump:

```bash
backup=/opt/roamlog/backups/roamlog-YYYYMMDDTHHMMSSZ
compose exec -T postgres sh -lc \
  'createdb -U "$POSTGRES_USER" roamlog_restore'
compose exec -T postgres sh -lc \
  'pg_restore -U "$POSTGRES_USER" -d roamlog_restore --no-owner --no-acl' \
  < "$backup/postgres.dump"
```

Point an isolated API instance at `roamlog_restore`, run the migration status
command, and perform the smoke checks before considering the restore valid. Do
not run `--clean` against the live database unless an explicit data-loss review
has approved it and a fresh safety backup exists.

## Restore MinIO into an isolated bucket

Stop writes to the target bucket before an in-place restore. For an isolated
restore, use a different bucket:

```bash
backup=/opt/roamlog/backups/roamlog-YYYYMMDDTHHMMSSZ
RESTORE_BUCKET=roamlog-restore
compose run --rm --no-deps --user 0:0 \
  -v "$backup/minio:/backup:ro" \
  -e S3_ENDPOINT=http://minio:9000 \
  -e RESTORE_BUCKET="$RESTORE_BUCKET" \
  --entrypoint sh minio-init -lc '
    set -eu
    mc alias set restore "$S3_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mb --ignore-existing "restore/$RESTORE_BUCKET"
    mc anonymous set none "restore/$RESTORE_BUCKET"
    mc mirror --preserve /backup "restore/$RESTORE_BUCKET"
  '
```

For an in-place restore, stop API and worker first, restore the same bucket, and
verify object counts, a private signed read, a thumbnail, and an export before
starting traffic. Never make the bucket public as a recovery shortcut.

## Restore the deployment env

Only after comparing the backup with the current deployment configuration:

```bash
sudo install -m 600 "$backup/env" /opt/roamlog/config/.env.production
sudo docker compose \
  --project-directory /opt/roamlog/repo \
  --project-name roamlog \
  --env-file /opt/roamlog/config/.env.production \
  -f /opt/roamlog/repo/docker/compose.production.yml \
  --profile init config --quiet
```

Treat a restored env file as a credential-bearing artifact. Rotate any secret
that may have been exposed while the backup was copied, restored, or handled.

## Drill evidence

Record the backup identifier, checksum verification, restore target, migration
version, `/v1/ready` response, login and permission checks, one private media
read, one queue-backed operation, RPO/RTO measurement, failures, and owner.
