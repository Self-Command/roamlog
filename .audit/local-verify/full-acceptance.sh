#!/usr/bin/env bash
# Full-repo acceptance gates — the precondition for tagging rc.5.
#   bash .audit/local-verify/full-acceptance.sh
# Fails fast, writes evidence under .audit/evidence/full/.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

OUT=.audit/evidence/full
mkdir -p "$OUT"
FAIL=0
declare -a RESULTS=()

gate() { # name, command
  local name="$1" cmd="$2" log="$OUT/${name}.log"
  printf '\n=== %s ===\n' "$name"
  local start; start=$(date +%s)
  bash -lc "$cmd" >"$log" 2>&1
  local code=$? dur=$(( $(date +%s) - start ))
  if [ $code -eq 0 ]; then
    RESULTS+=("PASS  $name  ${dur}s"); printf 'PASS %s (%ss)\n' "$name" "$dur"
  else
    RESULTS+=("FAIL  $name  ${dur}s exit=$code"); printf 'FAIL %s -> %s\n' "$name" "$log"; FAIL=1
  fi
}

contains() { # name, pattern, paths...
  local name="$1" pattern="$2"; shift 2
  printf '\n=== %s ===\n' "$name"
  local hits count
  hits=$(rg -n --no-heading -e "$pattern" "$@" 2>/dev/null || true)
  if [ -z "$hits" ]; then
    RESULTS+=("PASS  $name (0 hits)"); printf 'PASS (0 hits)\n'
  else
    count=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
    RESULTS+=("FAIL  $name ($count hits)")
    printf 'FAIL: %s\n%s\n' "$name" "$(printf '%s\n' "$hits" | head -20)"
    printf '%s\n' "$hits" >"$OUT/${name}.hits.txt"
    FAIL=1
  fi
}

ADMIN_DB='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public'

echo "== 0. CodeGraph freshness =="
codegraph status 2>/dev/null | tail -2 || echo "codegraph status unavailable"

echo "== 1. static: typecheck + lint + generated contracts =="
gate typecheck-all   "pnpm typecheck"
gate lint-all        "pnpm lint"
gate contracts-check "pnpm contracts:check"

echo "== 2. tests =="
gate test-contracts "pnpm --filter @roamlog/contracts test"
gate test-db        "ROAMLOG_TEST_DATABASE_URL='$ADMIN_DB' pnpm --filter @roamlog/db test"
gate test-api       "DATABASE_URL='$ADMIN_DB' ROAMLOG_TEST_DATABASE_URL='$ADMIN_DB' pnpm --filter @roamlog/api test"
gate test-web       "pnpm --filter @roamlog/web test"
gate test-admin     "pnpm --filter @roamlog/admin test"
gate test-apimocks  "pnpm --filter @roamlog/api-mocks test"

echo "== 3. production builds =="
rm -rf apps/web/.next/dev apps/admin/.next/dev
gate build-all "pnpm build"

echo "== 4. honesty gates (no fake features, no developer copy) =="
# Developer-facing copy must never reach a user-visible surface.
contains "copy-dev-web"   "(?i)live api|local fixture|数据来源：mock|演示数据" apps/web/components apps/web/app --glob '!**/*.test.*'
contains "copy-dev-admin" "(?i)演示预览|admin api error|fixture" apps/admin/components apps/admin/app --glob '!**/*.test.*'
# The vague "backend wired" phrasing hid settings that nothing read. It must stay dead.
contains "label-vague"    "已接入后端" apps/admin
# Build artifacts must carry no fixture or demo code.
ART_EXCLUDES=(--glob '!cache/**' --glob '!**/*.map' --glob '!**/*.nft.json' --glob '!**/static/media/**')
contains "artifact-fixtures" "(?i)demo-store|demoFixtureState|legacy-mock" apps/web/.next apps/admin/.next "${ART_EXCLUDES[@]}"

echo "== 5. contract/implementation drift =="
# These endpoints have a strict response schema; a mismatch means clients parse a lie.
gate drift-health "curl -sf -m 10 http://127.0.0.1:4000/v1/health | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!('version' in j)||!('uptimeSeconds' in j)||j.status!=='ok'){console.error('health drift:',JSON.stringify(j));process.exit(1)}console.log('health ok')})\""
gate drift-ready  "curl -sf -m 10 http://127.0.0.1:4000/v1/ready  | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!['ok','degraded','unavailable'].includes(j.status)){console.error('ready drift:',j.status);process.exit(1)}for(const k of ['database','redis','storage']){if(!(k in j.checks)){console.error('ready missing check:',k);process.exit(1)}}console.log('ready ok:',j.status)})\""

echo "== 6. migrations apply to a clean database =="
gate migrate-clean "DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_clean_gate?schema=public' pnpm db:migrate"

echo "== 7. e2e suite loads (Playwright can import every spec) =="
gate e2e-list "pnpm exec playwright test --list"

echo "== 8. summary =="
for r in "${RESULTS[@]}"; do echo "$r"; done
printf '\nEvidence: %s\n' "$OUT"
exit $FAIL