#!/usr/bin/env bash
# DESTINATIONS_UPGRADE — isolated end-to-end run (API 4270, schema dest_e2e).
#
# Starts a real API process against a throwaway PostgreSQL schema, seeds a
# verified owner, then runs destinations-e2e.mjs. Nothing touches the default
# `public`/`dest` schemas or port 4000.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 1

SCHEMA="dest_e2e"
PORT=4270
DB="postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=$SCHEMA"
TMP="$REPO/.data/dest-e2e"
LOG="$REPO/.audit/local-verify/dest-e2e-api.log"
COOKIE_JAR="$TMP/cookies.txt"
API_PID=""

mkdir -p "$TMP"
rm -f "$COOKIE_JAR"
: > "$LOG"

step() { printf '\n===== %s =====\n' "$1"; }

cleanup() {
  if [ -n "$API_PID" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  local os_pid
  os_pid=$(netstat -ano 2>/dev/null | grep -E "127\.0\.0\.1:$PORT .*LISTENING" | head -1 | awk '{print $NF}')
  if [ -n "${os_pid:-}" ]; then
    taskkill //PID "$os_pid" //T //F >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

step "0. reset throwaway schema $SCHEMA"
node -e "
const { Client } = require('./packages/db/node_modules/pg');
(async () => {
  const client = new Client({ host: '127.0.0.1', port: 55444, user: 'postgres', database: 'roamlog_local' });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS \"$SCHEMA\" CASCADE');
  await client.end();
  console.log('schema $SCHEMA dropped');
})().catch((error) => { console.error(error.message); process.exit(1); });
" || exit 1

step "1. prisma migrate deploy (0001 -> 0010)"
DATABASE_URL="$DB" pnpm --filter @roamlog/db exec prisma migrate deploy 2>&1 | tail -4 || exit 1

step "2. seed verified owner + workspace"
DATABASE_URL="$DB" \
VERIFY_EMAIL="dest-e2e@roamlog.test" \
VERIFY_PASSWORD="Roamlog-Dest-Aa1!" \
VERIFY_NAME="Dest E2E Owner" \
VERIFY_WORKSPACE="目的地验收工作区" \
VERIFY_SLUG="dest-e2e-crew" \
pnpm --filter @roamlog/api exec tsx ../../.audit/local-verify/seed-user.ts 2>&1 | tail -12 || exit 1

step "3. start API on 127.0.0.1:$PORT"
cd "$REPO/apps/api" || exit 1
export NODE_ENV=development
export LOG_LEVEL=error
export API_PORT="$PORT"
export API_URL="http://127.0.0.1:$PORT"
export APP_URL="http://localhost:3000"
export CORS_ORIGINS="http://localhost:3000"
export DATABASE_URL="$DB"
export BETTER_AUTH_SECRET="dest-e2e-secret-at-least-32-bytes-long-123"
export BETTER_AUTH_URL="http://127.0.0.1:$PORT"
export REDIS_URL="redis://127.0.0.1:1"
export REDIS_REQUIRED=false
export REDIS_PREFIX="roamlog_dest_e2e"
npx tsx src/main.ts >>"$LOG" 2>&1 &
API_PID=$!
echo "api wrapper pid=$API_PID (see $LOG)"

step "4. destinations end-to-end"
cd "$REPO" || exit 1
DEST_E2E_API_URL="http://127.0.0.1:$PORT" node .audit/local-verify/destinations-e2e.mjs
RESULT=$?

step "5. API log (errors only)"
grep -a -iE "error|exception|failed" "$LOG" | head -10 || true

printf '\nE2E exit code: %s\n' "$RESULT"
exit "$RESULT"