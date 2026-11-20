#!/usr/bin/env bash
# Stage A acceptance gates. Run from the repo root.
#   bash .audit/local-verify/stage-a-acceptance.sh
# Fails fast on the first red gate and writes evidence under .audit/evidence/stage-a/.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

OUT=.audit/evidence/stage-a
mkdir -p "$OUT"
FAIL=0
declare -a RESULTS=()

gate() { # name, command
  local name="$1" cmd="$2" log="$OUT/${1}.log"
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

echo "== 0. index freshness =="
codegraph status | tail -3 || true

echo "== 1. static gates =="
gate typecheck-web     "pnpm --filter @roamlog/web typecheck"
gate typecheck-admin   "pnpm --filter @roamlog/admin typecheck"
gate typecheck-api     "pnpm --filter @roamlog/api typecheck"
gate lint              "pnpm lint"
gate test-web          "pnpm --filter @roamlog/web test"
gate test-admin        "pnpm --filter @roamlog/admin test"

echo "== 2. copy gates (source, tests excluded) =="
# Case insensitive: several labels are uppercased by CSS only, so a
# case-sensitive grep silently misses them (found the hard way).
contains "copy-web"   "(?i)live api|msw|local fixture|本地演示数据|admin api error|data mode|useDataMode" apps/web/components apps/web/app --glob '!**/*.test.*'
contains "copy-admin" "(?i)msw|fixture|演示预览|live api|admin api error" apps/admin/components apps/admin/app --glob '!**/*.test.*'
gate copy-dev-semantics "node .audit/local-verify/copy-gate.mjs"
contains "dead-branch" 'mode\s*===\s*"mock"|mode\s*!==\s*"api"' apps/web apps/admin --glob '!**/*.test.*'

# The retired build flag must not exist as a *definition*. A migration note in
# the docs and an explicit "retired flag" guard are allowed and desirable.
contains "build-flag-arg"   '^\s*(ARG|ENV)\s+NEXT_PUBLIC_(ADMIN_)?DATA_MODE' docker
contains "build-flag-compose" '^\s*NEXT_PUBLIC_(ADMIN_)?DATA_MODE\s*:' docker
contains "build-flag-env"   '^\s*NEXT_PUBLIC_(ADMIN_)?DATA_MODE\s*=' docker .env.example

echo "== 3. build (production mode) =="
rm -rf apps/web/.next/dev apps/admin/.next/dev
gate build-web   "pnpm --filter @roamlog/web build"
gate build-admin "pnpm --filter @roamlog/admin build"

echo "== 4. build artifact gates =="
# Vendor bundles (maplibre minified identifiers), source maps and Next's file
# trace manifest are not product copy; everything else must be clean.
ART_EXCLUDES=(--glob '!cache/**' --glob '!**/*.map' --glob '!**/*.nft.json' --glob '!**/static/media/**')
contains "artifact-fixtures" "(?i)demo-store|api-mocks|demoFixtureState|legacy-mock" apps/web/.next apps/admin/.next "${ART_EXCLUDES[@]}"
contains "artifact-copy"     "(?i)本地演示数据|live api|local fixture|\bmsw\b|data mode" apps/web/.next apps/admin/.next "${ART_EXCLUDES[@]}" 

echo "== 5. summary =="
for r in "${RESULTS[@]}"; do echo "$r"; done
printf '\nEvidence: %s\n' "$OUT"
exit $FAIL
