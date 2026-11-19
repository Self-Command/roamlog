#!/usr/bin/env bash
# Roamlog rc.4 cutover: staging stack -> production stack.
# Run on the server as root. Idempotent-ish, fails fast, supports rollback.
#
#   ./cutover-rc4.sh pull     # only pull the 5 images (no downtime)
#   ./cutover-rc4.sh switch   # stop staging, start production, smoke test
#   ./cutover-rc4.sh rollback # production down, staging up again
set -uo pipefail

REPO=/opt/roamlog/repo
CFG=/opt/roamlog/config
PROD_ENV=$CFG/.env.production
TAG=v0.1.0-rc.4
COMPONENTS="api migrate worker web admin"
PROD="docker compose -p roamlog --env-file $PROD_ENV -f $REPO/docker/compose.production.yml"
STAGE="docker compose -p roamlog-staging --env-file $CFG/.env.staging -f $REPO/docker/compose.staging.yml -f $REPO/docker/compose.server.yml"

log() { printf '\n== %s ==\n' "$*"; }

pull_images() {
  log "pull $TAG"
  local failed=0
  for c in $COMPONENTS; do
    if docker pull "ghcr.io/self-command/roamlog/$c:$TAG" >/dev/null 2>&1; then
      echo "  pulled $c"
    else
      echo "  FAILED $c"; failed=1
    fi
  done
  [ "$failed" -eq 0 ] || { echo "PULL_FAILED"; exit 1; }
  log "digests"
  for c in $COMPONENTS; do
    printf '  %-8s %s\n' "$c" "$(docker image inspect --format '{{index .RepoDigests 0}}' "ghcr.io/self-command/roamlog/$c:$TAG" 2>/dev/null || echo NO_DIGEST)"
  done
  echo "PULL_OK"
}

smoke() {
  log "smoke"
  local ok=1
  wait_for() { # name url expected
    local name="$1" url="$2" want="$3" got=""
    for _ in $(seq 1 30); do
      got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || echo 000)
      [ "$got" = "$want" ] && { echo "  ok   $name $got"; return 0; }
      sleep 2
    done
    echo "  FAIL $name got=$got want=$want"; ok=0; return 1
  }
  wait_for "api health"  "http://127.0.0.1:14000/v1/health" 200
  wait_for "api ready"   "http://127.0.0.1:14000/v1/ready"  200
  wait_for "web login"   "http://127.0.0.1:13000/login"     200
  wait_for "admin login" "http://127.0.0.1:13001/admin/login" 200
  wait_for "media bucket" "http://127.0.0.1:19000/roamlog/" 403

  log "app metrics must stay hidden"
  code=$(curl -s -o /dev/null -w '%{http_code}' --resolve we.spacedo.org:443:127.0.0.1 --max-time 6 'https://we.spacedo.org/v1/metrics' || echo 000)
  [ "$code" = "404" ] && echo "  ok   /v1/metrics 404" || { echo "  FAIL /v1/metrics got=$code"; ok=0; }

  log "media host header through nginx"
  curl -s -o /dev/null -w '  media /roamlog/ (unsigned -> 403) : %{http_code}\n' \
    --resolve media.spacedo.org:443:127.0.0.1 'https://media.spacedo.org/roamlog/probe'
  echo "  presign host check happens in the app smoke, see docs/operations/media-delivery.md"

  log "container state"
  docker compose -p roamlog --env-file "$PROD_ENV" -f "$REPO/docker/compose.production.yml" ps --format '  {{.Name}} {{.Status}}' 2>/dev/null

  [ "$ok" -eq 1 ] && echo "SMOKE_OK" || { echo "SMOKE_FAILED"; return 1; }
}

do_switch() {
  log "stop staging (only the roamlog-staging project)"
  $STAGE --profile app stop
  log "confirm ports released"
  for p in 13000 13001 14000; do
    if ss -ltn | grep -q ":$p "; then echo "  port $p STILL BUSY"; else echo "  port $p free"; fi
  done

  log "start production"
  if ! $PROD up -d --no-build; then
    echo "UP_FAILED"; echo "--- api logs ---"
    docker logs --tail 60 roamlog-api-1 2>&1 | tail -40
    return 1
  fi

  if ! smoke; then
    echo "--- api logs ---"
    docker logs --tail 80 roamlog-api-1 2>&1 | tail -50
    return 1
  fi
  echo "SWITCH_OK"
}

do_rollback() {
  log "stop production"
  $PROD down --remove-orphans || true
  log "start staging again"
  $STAGE -f "$REPO/docker/compose.server.yml" up -d --no-build || \
    ROAMLOG_IMAGE_TAG=v0.1.0-rc.3 $STAGE up -d --no-build
  sleep 5
  for p in 13000 13001 14000; do
    printf '  port %s: %s\n' "$p" "$(ss -ltn | grep -c ":$p ")"
  done
  curl -s -o /dev/null -w '  web login: %{http_code}\n' http://127.0.0.1:13000/login
  curl -s -o /dev/null -w '  api health: %{http_code}\n' http://127.0.0.1:14000/v1/health
  echo "ROLLBACK_DONE"
}

case "${1:-}" in
  pull)     pull_images ;;
  switch)   do_switch ;;
  rollback) do_rollback ;;
  smoke)    smoke ;;
  *) echo "usage: $0 {pull|switch|smoke|rollback}"; exit 2 ;;
esac