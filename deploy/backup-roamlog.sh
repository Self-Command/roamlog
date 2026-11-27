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
#   ROAMLOG_ENV_FILE=/opt/roamlog/config/.env.production
#   ROAMLOG_COMPOSE_FILE=/opt/roamlog/repo/docker/compose.production.yml
#   ROAMLOG_COMPOSE_PROJECT_NAME=roamlog
#   BACKUP_MC_IMAGE=docker.io/chainguard/minio-client@sha256:...
#   BACKUP_MC_HOST=http://ACCESS:SECRET@minio:9000
#
# Standard Compose overrides are also accepted:
#   COMPOSE_FILE (colon-separated file list), COMPOSE_ENV_FILE,
#   COMPOSE_PROJECT_NAME

umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/opt/roamlog/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
ROAMLOG_REPO_DIR="${ROAMLOG_REPO_DIR:-/opt/roamlog/repo}"
ROAMLOG_ENV_FILE="${ROAMLOG_ENV_FILE:-${COMPOSE_ENV_FILE:-/opt/roamlog/config/.env.production}}"
ROAMLOG_COMPOSE_PROJECT_NAME="${ROAMLOG_COMPOSE_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-roamlog}}"
BACKUP_MC_IMAGE="${BACKUP_MC_IMAGE:-docker.io/chainguard/minio-client@sha256:b26a2a817e83c41189d6462c21b378633f807f18b44e84157fd6b6f296b5fc6d}"
BACKUP_MC_HOST="${BACKUP_MC_HOST:-}"

usage() {
  sed -n '4,24p' "$0" | sed 's/^# \{0,1\}//'
}

fail() {
  printf 'backup-roamlog: %s\n' "$*" >&2
  exit 1
}

env_value() {
  local key="$1"
  local line value
  line="$(grep -E "^[[:space:]]*${key}=" "$ROAMLOG_ENV_FILE" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

on_exit() {
  status=$?
  if (( status != 0 )) && [[ -n "${work_dir:-}" && -d "$work_dir" ]]; then
    printf 'backup-roamlog: incomplete backup left for inspection: %s\n' "$work_dir" >&2
  fi
}

trap on_exit EXIT

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

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
[[ -f "$ROAMLOG_ENV_FILE" && -r "$ROAMLOG_ENV_FILE" ]] || fail "ROAMLOG_ENV_FILE is not readable: $ROAMLOG_ENV_FILE"

compose_files=()
if [[ -n "${ROAMLOG_COMPOSE_FILE:-}" ]]; then
  compose_files=("$ROAMLOG_COMPOSE_FILE")
elif [[ -n "${COMPOSE_FILE:-}" ]]; then
  IFS=':' read -r -a compose_files <<<"$COMPOSE_FILE"
else
  compose_files=("$ROAMLOG_REPO_DIR/docker/compose.production.yml")
fi
(( ${#compose_files[@]} > 0 )) || fail "at least one Compose file is required"

compose_file_args=()
for compose_file in "${compose_files[@]}"; do
  [[ -f "$compose_file" && -r "$compose_file" ]] ||
    fail "Compose file is not readable: $compose_file"
  compose_file_args+=(-f "$compose_file")
done

[[ "$ROAMLOG_COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] ||
  fail "ROAMLOG_COMPOSE_PROJECT_NAME must be a Docker Compose project name"

for required_command in \
  awk docker du find grep hostname install mktemp realpath sed sha256sum sort tail xargs; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "$required_command is required"
done

BACKUP_ROOT="$(realpath -m -- "$BACKUP_ROOT")"
[[ "$BACKUP_ROOT" != "/" ]] || fail "resolved BACKUP_ROOT must not be /"

mkdir -p -- "$BACKUP_ROOT"
chmod 700 -- "$BACKUP_ROOT"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_backup_dir="$BACKUP_ROOT/roamlog-${stamp}"
[[ ! -e "$final_backup_dir" ]] || fail "backup destination already exists: $final_backup_dir"
work_dir="$(mktemp -d "$BACKUP_ROOT/.roamlog-incomplete-${stamp}.XXXXXX")"
chmod 700 -- "$work_dir"

postgres_dump="$work_dir/postgres.dump"
postgres_tmp="$postgres_dump.partial"
minio_dir="$work_dir/minio"
mkdir -p -- "$minio_dir"

compose() {
  docker compose \
    --project-directory "$ROAMLOG_REPO_DIR" \
    --project-name "$ROAMLOG_COMPOSE_PROJECT_NAME" \
    --env-file "$ROAMLOG_ENV_FILE" \
    "${compose_file_args[@]}" \
    --profile init \
    "$@"
}

printf 'backup-roamlog: validating Compose configuration\n'
compose config --quiet >/dev/null

printf 'backup-roamlog: dumping PostgreSQL\n'
compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$postgres_tmp"
[[ -s "$postgres_tmp" ]] || fail "PostgreSQL dump is empty"
compose exec -T postgres pg_restore --list < "$postgres_tmp" >/dev/null
mv -- "$postgres_tmp" "$postgres_dump"
(cd "$work_dir" && sha256sum postgres.dump > postgres.dump.sha256)

printf 'backup-roamlog: copying deployment env (mode 0600)\n'
install -m 600 -- "$ROAMLOG_ENV_FILE" "$work_dir/env"

printf 'backup-roamlog: mirroring the private MinIO bucket\n'
backup_s3_bucket="$(env_value S3_BUCKET)"
[[ -n "$backup_s3_bucket" ]] || fail "S3_BUCKET is missing from ROAMLOG_ENV_FILE"
[[ "$backup_s3_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] ||
  fail "S3_BUCKET must be a valid lowercase S3 bucket name"

mc_host="$BACKUP_MC_HOST"
if [[ -z "$mc_host" ]]; then
  backup_s3_access_key="$(env_value S3_ACCESS_KEY)"
  backup_s3_secret_key="$(env_value S3_SECRET_KEY)"
  [[ -n "$backup_s3_access_key" && -n "$backup_s3_secret_key" ]] ||
    fail "S3_ACCESS_KEY and S3_SECRET_KEY are required from ROAMLOG_ENV_FILE"
  # MC_HOST aliases are URLs, so credentials must be URL-safe. Preserve a
  # documented escape hatch for operators whose credentials contain reserved
  # characters instead of leaking or mangling them.
  [[ "$backup_s3_access_key" =~ ^[A-Za-z0-9._~-]+$ ]] &&
    [[ "$backup_s3_secret_key" =~ ^[A-Za-z0-9._~-]+$ ]] ||
    fail "S3 credentials contain URL-reserved characters; set BACKUP_MC_HOST explicitly"
  mc_host="http://${backup_s3_access_key}:${backup_s3_secret_key}@minio:9000"
fi

minio_network="${ROAMLOG_COMPOSE_PROJECT_NAME}_backend"
MC_HOST_backup="$mc_host" docker run --rm \
  --network "$minio_network" \
  --user 0:0 \
  -e MC_HOST_backup \
  -e MC_CONFIG_DIR=/tmp/mc \
  --tmpfs /tmp \
  -v "$minio_dir:/backup" \
  --entrypoint /usr/bin/mc \
  "$BACKUP_MC_IMAGE" \
  --quiet mirror --preserve "backup/$backup_s3_bucket" /backup

{
  printf 'format=roamlog-backup-v1\n'
  printf 'created_at=%s\n' "$stamp"
  printf 'host=%s\n' "$(hostname)"
  printf 'postgres_dump=postgres.dump\n'
  printf 'minio_layout=bucket-mirror\n'
  printf 'env_mode=0600\n'
} > "$work_dir/manifest.txt"

printf 'backup-roamlog: hashing backup artifacts\n'
(
  cd "$work_dir"
  find . -type f ! -name SHA256SUMS ! -name COMPLETE -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
)

find "$work_dir" -type d -exec chmod 700 {} +
find "$work_dir" -type f -exec chmod 600 {} +

touch "$work_dir/COMPLETE"
chmod 600 "$work_dir/COMPLETE"

# Only a fully verified run receives the public ``roamlog-*`` name. Failures
# remain under the hidden incomplete prefix and are never mistaken for a
# restore candidate.
mv -- "$work_dir" "$final_backup_dir"
backup_dir="$final_backup_dir"
work_dir=""

printf 'backup-roamlog: applying retention of %s days\n' "$BACKUP_RETENTION_DAYS"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'roamlog-*' \
  -mtime +"$BACKUP_RETENTION_DAYS" -print0 \
  | while IFS= read -r -d '' old_backup; do
      [[ -f "$old_backup/COMPLETE" ]] || continue
      rm -rf -- "$old_backup"
    done

printf 'backup-roamlog: complete: %s\n' "$backup_dir"
printf 'backup-roamlog: size: %s\n' "$(du -sh "$backup_dir" | awk '{print $1}')"
