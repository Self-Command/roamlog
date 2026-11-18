#!/usr/bin/env bash
# G1 集成门禁 — 复现 .github/workflows/ci.yml 的 quality job（本地无 Docker 版本）
# 用法: bash .audit/g1-verify.sh
# 证据写入 .audit/evidence/g1-<timestamp>/
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT=".audit/evidence/g1-$STAMP"
mkdir -p "$OUT"
FAIL=0
declare -a RESULTS=()

run() {
  local name="$1" cmd="$2"
  local log="$OUT/${name}.log"
  printf '\n=== %s ===\n' "$name"
  local start; start=$(date +%s)
  bash -lc "$cmd" >"$log" 2>&1
  local code=$?
  local dur=$(( $(date +%s) - start ))
  if [ $code -eq 0 ]; then
    RESULTS+=("PASS  $name  ${dur}s")
    printf 'PASS %s (%ss)\n' "$name" "$dur"
  else
    RESULTS+=("FAIL  $name  ${dur}s  exit=$code")
    printf 'FAIL %s (%ss) exit=%s -> %s\n' "$name" "$dur" "$code" "$log"
    FAIL=1
  fi
}

echo "CodeGraph gate"
codegraph status | tail -5

run "contracts-check"   "pnpm contracts:check"
run "typecheck"         "pnpm typecheck"
run "lint"              "pnpm lint"
run "test"              "pnpm test"
run "build"             "pnpm build"

printf '\n===== SUMMARY =====\n'
for r in "${RESULTS[@]}"; do echo "$r"; done
printf '\nEvidence: %s\n' "$OUT"
exit $FAIL