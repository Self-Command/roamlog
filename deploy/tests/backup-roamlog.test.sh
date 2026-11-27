#!/usr/bin/env bash
set -Eeuo pipefail

# Fixture tests for deploy/backup-roamlog.sh. They require root because the
# production script deliberately refuses to read the secret env file as an
# unprivileged user. Run on a disposable Linux host or in CI with sudo.
if [[ "${EUID}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    exec sudo -E bash "$0" "$@"
  fi
  printf 'backup-roamlog test: run as root (no passwordless sudo available)\n' >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
backup_script="$script_dir/backup-roamlog.sh"
[[ -f "$backup_script" ]] || {
  printf 'backup-roamlog test: missing %s\n' "$backup_script" >&2
  exit 1
}

test_root="$(mktemp -d)"
cleanup() {
  rm -rf -- "$test_root"
}
trap cleanup EXIT

fail() {
  printf 'backup-roamlog test: FAIL: %s\n' "$*" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || fail "expected file: $1"
}

assert_absent() {
  [[ ! -e "$1" ]] || fail "expected path to be absent: $1"
}

make_fixture() {
  local name="$1"
  local root="$test_root/$name"
  mkdir -p "$root/repo/docker" "$root/config" "$root/backups" "$root/bin"
  printf 'name: fixture\nservices: {}\n' >"$root/repo/docker/compose.production.yml"
  cat >"$root/config/.env.production" <<'ENV'
POSTGRES_USER=fixture
S3_BUCKET=fixture-bucket
S3_ACCESS_KEY=fixture-access
S3_SECRET_KEY=fixture-secret
ENV
  cp "$root/config/.env.production" "$root/config/custom.env"

  cat >"$root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"${MOCK_DOCKER_LOG:?}"
args="$*"

if [[ "${MOCK_FAIL_MODE:-}" == "dump" && "$args" == *"pg_dump"* ]]; then
  exit 41
fi
if [[ "${MOCK_FAIL_MODE:-}" == "restore" && "$args" == *"pg_restore --list"* ]]; then
  exit 42
fi

if [[ "$args" == *"pg_restore --list"* ]]; then
  cat >/dev/null
  exit 0
fi
if [[ "$args" == *"pg_dump"* ]]; then
  if [[ "${MOCK_EMPTY_DUMP:-}" == "1" ]]; then
    exit 0
  fi
  printf 'fixture-custom-format-dump'
  exit 0
fi

# `compose config`, `compose run minio-init` and every other fixture call are
# successful no-ops. The object mirror is an empty bucket in this fixture.
exit 0
MOCK
  chmod 700 "$root/bin/docker"
  printf '%s\n' "$root"
}

run_backup() {
  local root="$1"
  local env_file="${ROAMLOG_ENV_FILE:-${COMPOSE_ENV_FILE:-$root/config/.env.production}}"
  shift
  env \
    PATH="$root/bin:$PATH" \
    BACKUP_ROOT="$root/backups" \
    BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}" \
    ROAMLOG_REPO_DIR="$root/repo" \
    ROAMLOG_ENV_FILE="$env_file" \
    MOCK_DOCKER_LOG="$root/docker.log" \
    "$@" \
    bash "$backup_script"
}

test_success_and_retention() {
  local root final_dir old_complete old_incomplete
  root="$(make_fixture success)"

  old_complete="$root/backups/roamlog-old-complete"
  old_incomplete="$root/backups/roamlog-old-incomplete"
  mkdir -p "$old_complete" "$old_incomplete"
  touch "$old_complete/COMPLETE"
  touch -d '5 days ago' "$old_complete" "$old_incomplete"

  BACKUP_RETENTION_DAYS=1 run_backup "$root"

  final_dir="$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -name 'roamlog-*' \
    -exec test -f '{}/COMPLETE' \; -print)"
  [[ -n "$final_dir" && "$final_dir" != *$'\n'* ]] ||
    fail "expected exactly one completed backup, got: ${final_dir:-none}"
  assert_file "$final_dir/postgres.dump"
  assert_file "$final_dir/env"
  assert_file "$final_dir/SHA256SUMS"
  assert_file "$final_dir/COMPLETE"
  grep -qE '^[0-9a-f]{64}  postgres\.dump$' "$final_dir/postgres.dump.sha256" ||
    fail "postgres.dump.sha256 must use a stable relative path"
  if grep -F -- "$root/backups" "$final_dir/postgres.dump.sha256" >/dev/null; then
    fail "postgres.dump.sha256 leaked the temporary work path"
  fi
  [[ "$(stat -c '%a' "$final_dir")" == "700" ]] || fail "backup directory is not 0700"
  [[ "$(stat -c '%a' "$final_dir/env")" == "600" ]] || fail "env backup is not 0600"
  (cd "$final_dir" && sha256sum -c SHA256SUMS >/dev/null)

  assert_absent "$old_complete"
  [[ -d "$old_incomplete" ]] || fail "retention deleted an incomplete backup"
  [[ -z "$(find "$root/backups" -mindepth 1 -maxdepth 1 -name '.roamlog-incomplete-*')" ]] ||
    fail "successful run left an incomplete directory"

  grep -F -- '--project-directory' "$root/docker.log" >/dev/null ||
    fail "Compose project directory was not passed"
  grep -F -- '--project-name roamlog' "$root/docker.log" >/dev/null ||
    fail "Compose project name was not passed"
  grep -F -- "$root/repo/docker/compose.production.yml" "$root/docker.log" >/dev/null ||
    fail "production Compose file was not used"
  grep -F -- "$root/config/.env.production" "$root/docker.log" >/dev/null ||
    fail "production env file was not used"
  grep -F -- 'pg_restore --list' "$root/docker.log" >/dev/null ||
    fail "pg_restore validation was not run"
  grep -F -- '--entrypoint /usr/bin/mc' "$root/docker.log" >/dev/null ||
    fail "mc mirror did not use the shell-free MinIO client image"
  grep -F -- 'mirror --preserve' "$root/docker.log" >/dev/null ||
    fail "MinIO mirror command was not run"
  printf 'ok - success + retention\n'
}

test_dump_failure_is_incomplete() {
  local root incomplete old_backup
  root="$(make_fixture dump-failure)"
  old_backup="$root/backups/roamlog-keep"
  mkdir -p "$old_backup"
  touch "$old_backup/COMPLETE"

  if MOCK_FAIL_MODE=dump run_backup "$root" >"$root/out.log" 2>"$root/err.log"; then
    fail "dump failure unexpectedly succeeded"
  fi

  incomplete="$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -name '.roamlog-incomplete-*')"
  [[ -n "$incomplete" && "$incomplete" != *$'\n'* ]] ||
    fail "expected one incomplete directory"
  [[ -d "$old_backup" ]] || fail "dump failure removed an existing backup"
  [[ -z "$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -name 'roamlog-*' \
    -exec test -f '{}/COMPLETE' \; -print | grep -vxF "$old_backup" || true)" ]] ||
    fail "dump failure produced a completed backup"
  grep -F 'incomplete backup left for inspection' "$root/err.log" >/dev/null ||
    fail "failure did not explain the incomplete directory"
  printf 'ok - dump failure remains incomplete\n'
}

test_restore_and_empty_dump_failures() {
  local root
  root="$(make_fixture restore-failure)"
  if MOCK_FAIL_MODE=restore run_backup "$root" >"$root/out.log" 2>"$root/err.log"; then
    fail "pg_restore failure unexpectedly succeeded"
  fi
  [[ -z "$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -name 'roamlog-*' \
    -exec test -f '{}/COMPLETE' \; -print)" ]] ||
    fail "restore failure produced a completed backup"

  root="$(make_fixture empty-dump)"
  if MOCK_EMPTY_DUMP=1 run_backup "$root" >"$root/out.log" 2>"$root/err.log"; then
    fail "empty dump unexpectedly succeeded"
  fi
  grep -F 'PostgreSQL dump is empty' "$root/err.log" >/dev/null ||
    fail "empty dump was not rejected"
  printf 'ok - restore + empty dump failures\n'
}

test_preflight_and_compose_overrides() {
  local root
  root="$(make_fixture preflight)"

  if ROAMLOG_COMPOSE_FILE="$root/missing.yml" run_backup "$root" \
    >"$root/out.log" 2>"$root/err.log"; then
    fail "missing Compose file unexpectedly passed preflight"
  fi
  grep -F 'Compose file is not readable' "$root/err.log" >/dev/null ||
    fail "missing Compose file did not produce a specific error"
  [[ -z "$(find "$root/backups" -mindepth 1 -maxdepth 1 -print)" ]] ||
    fail "preflight failure created a backup directory"

  COMPOSE_FILE="$root/repo/docker/compose.production.yml" \
    COMPOSE_ENV_FILE="$root/config/custom.env" \
    COMPOSE_PROJECT_NAME=custom-project \
    run_backup "$root" >"$root/out.log"
  grep -F -- '--project-name custom-project' "$root/docker.log" >/dev/null ||
    fail "COMPOSE_PROJECT_NAME override was ignored"
  grep -F -- "$root/config/custom.env" "$root/docker.log" >/dev/null ||
    fail "COMPOSE_ENV_FILE override was ignored"
  printf 'ok - preflight + Compose overrides\n'
}

test_help() {
  local help
  help="$(bash "$backup_script" --help)"
  [[ "$help" == *"BACKUP_ROOT"* && "$help" == *"ROAMLOG_COMPOSE_FILE"* ]] ||
    fail "--help did not document the supported variables"
  printf 'ok - help\n'
}

test_help
test_success_and_retention
test_dump_failure_is_incomplete
test_restore_and_empty_dump_failures
test_preflight_and_compose_overrides
printf 'backup-roamlog test: all checks passed\n'
