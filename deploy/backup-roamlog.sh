#!/usr/bin/env bash
set -Eeuo pipefail

# Production backup for the single-host Roamlog deployment.
#
# The backup contains PostgreSQL, the private MinIO bucket mirror, and a copy
# of the deployment env file. Every artifact is created with mode 0600 and the
# run directory is mode 0700. The env file is never printed.
#
# Usage:
#   sudo BACKUP_RETENTION_DAYS=14 /opt/roamlog/bin/backup-roamlog.sh
#
# Optional:
#   BACKUP_ROOT=/opt/roamlog/backups
#   ROAMLOG_REPO_DIR=/opt/roamlog/repo
#   ROAMLOG_ENV_FILE=/opt/roamlog/config/.env.staging

umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/opt/roamlog/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
ROAMLOG_REPO_DIR="${ROAMLOG_REPO_DIR:-/opt/roamlog/repo}"
ROAMLOG_ENV_FILE="${ROAMLOG_ENV_FILE:-/opt/roamlog/config/.env.staging}"

fail() {
  printf 'backup-roamlog: %s\n' "$*" >&2
  exit 1
}

cleanup_partial() {
  rm -f -- "${postgres_tmp:-}"
}

on_exit() {
  status=$?
  cleanup_partial
  if (( status != 0 )) && [[ -n "${backup_dir:-}" ]]; then
    printf 'backup-roamlog: incomplete backup left for inspection: %s\n' "$backup_dir" >&2
  fi
}

trap on_exit EXIT

[[ "${EUID}" -eq 0 ]] || fail "run as root; the deployment env file must not be exposed to a non-root account"

case "$BACKUP_ROOT" in
  /*) ;;
  *) fail "BACKUP_ROOT must be an absolute path" ;;
esac
[[ -n "$BACKUP_ROOT" && "$BACKUP_ROOT" != "/" ]] || fail "BACKUP_ROOT must not be /"

case "$BACKUP_RETENTION_DAYS" in
  ''|*[!0-9]*) fail "BACKUP_RETENTION_DAYS must be a positive integer" ;;
esac
(( BACKUP_RETENTION_DAYS >= 1 )) || fail "BACKUP_RETENTION_DAYS must be at least 1"

[[ -d "$ROAMLOG_REPO_DIR" ]] || fail "ROAMLOG_REPO_DIR does not exist: $ROAMLOG_REPO_DIR"
[[ -f "$ROAMLOG_REPO_DIR/docker/compose.staging.yml" ]] || fail "missing compose.staging.yml under ROAMLOG_REPO_DIR"
[[ -f "$ROAMLOG_REPO_DIR/docker/compose.server.yml" ]] || fail "missing compose.server.yml under ROAMLOG_REPO_DIR"
[[ -f "$ROAMLOG_ENV_FILE" && -r "$ROAMLOG_ENV_FILE" ]] || fail "ROAMLOG_ENV_FILE is not readable: $ROAMLOG_ENV_FILE"

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v find >/dev/null 2>&1 || fail "find is required"
command -v install >/dev/null 2>&1 || fail "install is required"
command -v mktemp >/dev/null 2>&1 || fail "mktemp is required"
command -v realpath >/dev/null 2>&1 || fail "realpath is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

BACKUP_ROOT="$(realpath -m -- "$BACKUP_ROOT")"
[[ "$BACKUP_ROOT" != "/" ]] || fail "resolved BACKUP_ROOT must not be /"

mkdir -p -- "$BACKUP_ROOT"
chmod 700 -- "$BACKUP_ROOT"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$(mktemp -d "$BACKUP_ROOT/roamlog-${stamp}.XXXXXX")"
chmod 700 -- "$backup_dir"

postgres_dump="$backup_dir/postgres.dump"
postgres_tmp="$postgres_dump.partial"
minio_dir="$backup_dir/minio"
mkdir -p -- "$minio_dir"

compose() {
  docker compose \
    --env-file "$ROAMLOG_ENV_FILE" \
    -f "$ROAMLOG_REPO_DIR/docker/compose.staging.yml" \
    -f "$ROAMLOG_REPO_DIR/docker/compose.server.yml" \
    --profile app "$@"
}

printf 'backup-roamlog: dumping PostgreSQL\n'
compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$postgres_tmp"
[[ -s "$postgres_tmp" ]] || fail "PostgreSQL dump is empty"
compose exec -T postgres pg_restore --list < "$postgres_tmp" >/dev/null
mv -- "$postgres_tmp" "$postgres_dump"
sha256sum -- "$postgres_dump" > "$backup_dir/postgres.dump.sha256"

printf 'backup-roamlog: copying deployment env (mode 0600)\n'
install -m 600 -- "$ROAMLOG_ENV_FILE" "$backup_dir/env"

printf 'backup-roamlog: mirroring the private MinIO bucket\n'
compose run --rm --no-deps --user 0:0 \
  -v "$minio_dir:/backup" \
  -e S3_ENDPOINT=http://minio:9000 \
  --entrypoint sh minio-init -lc '
    set -eu
    mc alias set backup "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
    mc mirror --preserve "backup/$S3_BUCKET" /backup
  '

{
  printf 'format=roamlog-backup-v1\n'
  printf 'created_at=%s\n' "$stamp"
  printf 'host=%s\n' "$(hostname)"
  printf 'postgres_dump=postgres.dump\n'
  printf 'minio_layout=bucket-mirror\n'
  printf 'env_mode=0600\n'
} > "$backup_dir/manifest.txt"

printf 'backup-roamlog: hashing backup artifacts\n'
(
  cd "$backup_dir"
  find . -type f ! -name SHA256SUMS ! -name COMPLETE -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
)

find "$backup_dir" -type d -exec chmod 700 {} +
find "$backup_dir" -type f -exec chmod 600 {} +

touch "$backup_dir/COMPLETE"
chmod 600 "$backup_dir/COMPLETE"

printf 'backup-roamlog: applying retention of %s days\n' "$BACKUP_RETENTION_DAYS"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'roamlog-*' \
  -mtime +"$BACKUP_RETENTION_DAYS" -print0 \
  | while IFS= read -r -d '' old_backup; do
      [[ -f "$old_backup/COMPLETE" ]] || continue
      rm -rf -- "$old_backup"
    done

printf 'backup-roamlog: complete: %s\n' "$backup_dir"
printf 'backup-roamlog: size: %s\n' "$(du -sh "$backup_dir" | awk '{print $1}')"
