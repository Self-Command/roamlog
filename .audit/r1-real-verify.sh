#!/usr/bin/env bash
# R1_REDIS_RESILIENCE — real-process verification.
# Starts the real API (apps/api/src/main.ts) with REDIS_URL pointing at a CLOSED
# port (the exact production defect), then proves the process stays alive and
# answers /v1/health and /v1/ready (degraded, HTTP 200).
set -u

REPO="/c/Users/BY9700/Desktop/UI/roamlog"
API_DIR="$REPO/apps/api"
LOG="$REPO/.audit/r1-api-process.log"
S3_PORT=9111
API_PORT=4321

cd "$API_DIR" || exit 1

# --- fake S3 endpoint: HeadBucket must succeed so only Redis is down ----------
node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'application/xml'});s.end()}).listen($S3_PORT,'127.0.0.1')" &
S3_PID=$!
sleep 0.5
echo "fake-s3 pid=$S3_PID port=$S3_PORT"

# --- the API under test -------------------------------------------------------
export NODE_ENV=development
export APP_ENV=development
export LOG_LEVEL=info
export API_PORT=$API_PORT
export API_URL="http://127.0.0.1:$API_PORT"
export APP_URL="http://localhost:3000"
export ADMIN_URL="http://localhost:3001"
export DATABASE_URL="postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public"
export REDIS_URL="redis://127.0.0.1:1"
export REDIS_PREFIX="roamlog_r1"
export REDIS_REQUIRED=false
export BETTER_AUTH_SECRET="r1-verification-secret-at-least-32-bytes-long"
export S3_ENDPOINT="http://127.0.0.1:$S3_PORT"
export S3_BUCKET="roamlog"
export S3_ACCESS_KEY="r1-access-key"
export S3_SECRET_KEY="r1-secret-key"
export S3_REGION="us-east-1"
export S3_FORCE_PATH_STYLE=true

: > "$LOG"
npx tsx src/main.ts >>"$LOG" 2>&1 &
API_PID=$!
echo "api pid=$API_PID REDIS_URL=$REDIS_URL"

# Wait for the listener (max ~45s). The Redis failure must not abort boot.
for _ in $(seq 1 45); do
  if curl -s -o /dev/null -m 1 "http://127.0.0.1:$API_PORT/v1/health"; then
    break
  fi
  sleep 1
done

echo "--- ps ---"
ps -p "$API_PID" -o pid=,etime=,comm= 2>/dev/null || echo "process $API_PID NOT RUNNING"
echo "--- OS-level listener PID (netstat) ---"
netstat -ano | grep -E ":$API_PORT\s" | head -3
echo "--- tasklist for that PID ---"
OS_PID=$(netstat -ano | grep -E ":$API_PORT " | grep LISTENING | head -1 | awk '{print $NF}')
echo "OS_PID=$OS_PID"
tasklist //FI "PID eq $OS_PID" 2>/dev/null | tail -2
echo "--- kill -0 $API_PID (process alive?) ---"
if kill -0 "$API_PID" 2>/dev/null; then echo "ALIVE pid=$API_PID"; else echo "DEAD pid=$API_PID"; fi

echo "--- GET /v1/health (with status) ---"
curl -s -m 5 -w '\nHTTP %{http_code}\n' "http://127.0.0.1:$API_PORT/v1/health"

echo "--- GET /v1/ready (with status) ---"
curl -s -m 10 -w '\nHTTP %{http_code}\n' "http://127.0.0.1:$API_PORT/v1/ready"

echo "--- GET /v1/ready again (no crash after repeated degraded probes) ---"
curl -s -m 10 -o /dev/null -w 'HTTP %{http_code}\n' "http://127.0.0.1:$API_PORT/v1/ready"

echo "--- still alive after both probes? ---"
if kill -0 "$API_PID" 2>/dev/null; then echo "ALIVE pid=$API_PID"; else echo "DEAD pid=$API_PID"; fi

echo "--- api log (redis/heartbeat lines) ---"
grep -a -i -E "redis|api.started|failed to start" "$LOG" | head -20

echo "--- stopping processes we started ---"
kill "$API_PID" 2>/dev/null
sleep 2
kill "$S3_PID" 2>/dev/null
if kill -0 "$API_PID" 2>/dev/null; then echo "api still running (expected only if kill failed)"; else echo "api stopped cleanly after kill"; fi