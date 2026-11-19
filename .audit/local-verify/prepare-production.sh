#!/usr/bin/env bash
# Roamlog rc.4 production preparation (run on the server, root).
# Builds /opt/roamlog/config/.env.production from the staging env and validates
# the compose file. Never prints secret values.
set -euo pipefail

REPO=/opt/roamlog/repo
CFG=/opt/roamlog/config
SRC=$CFG/.env.staging
DST=$CFG/.env.production
TARGET_COMMIT="${1:-39c80a2f75b5d84c47c705c4713139afa4db9fd6}"

echo "== 1. sync repo =="
cd "$REPO"
git fetch --quiet origin main
git checkout -q -f "$TARGET_COMMIT"
echo "HEAD: $(git rev-parse --short HEAD)"
for f in docker/compose.production.yml docker/production.env.example deploy/nginx/media.conf.example; do
  [ -f "$f" ] && echo "present: $f" || { echo "MISSING: $f"; exit 1; }
done

echo "== 2. build .env.production =="
cp "$SRC" "$DST"
chmod 600 "$DST"; chown root:root "$DST"

setkv() {
  python3 - "$DST" "$1" "$2" <<'PY'
import sys
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
hit = False
out = []
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={val}"); hit = True
    else:
        out.append(line)
if not hit:
    out.append(f"{key}={val}")
open(path, "w").write("\n".join(out) + "\n")
PY
}

setkv NODE_ENV production
setkv APP_ENV production
setkv ROAMLOG_IMAGE_TAG v0.1.0-rc.4
setkv EMAIL_PROVIDER smtp
setkv SMTP_HOST smtp.gmail.com
setkv SMTP_PORT 465
setkv SMTP_USER hualuo9700@gmail.com
setkv SMTP_PASSWORD zjoefxkyotyjavaoj
setkv EMAIL_FROM "Roamlog <hualuo9700@gmail.com>"
setkv S3_PUBLIC_ENDPOINT https://media.spacedo.org
setkv S3_PUBLIC_BASE_URL https://media.spacedo.org
setkv MEDIA_SIGNED_URL_TTL_SECONDS 900
setkv MEDIA_CORS_ORIGINS https://we.spacedo.org
setkv TRUST_PROXY 1
setkv PRODUCTION_WEB_PORT 13000
setkv PRODUCTION_ADMIN_PORT 13001
setkv PRODUCTION_API_PORT 14000
setkv PRODUCTION_MINIO_S3_PORT 19000
setkv PRODUCTION_MINIO_CONSOLE_PORT 19001

echo "key count: $(grep -cE '^[A-Z0-9_]+=' "$DST")"
echo "== 3. compose validation =="
docker compose --env-file "$DST" -f "$REPO/docker/compose.production.yml" config --quiet \
  && echo "COMPOSE_CONFIG_OK"

echo "== 4. required keys sanity (names only) =="
for k in APP_ENV EMAIL_PROVIDER S3_PUBLIC_ENDPOINT POSTGRES_USER POSTGRES_DB REDIS_PASSWORD BETTER_AUTH_SECRET S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY MINIO_ROOT_USER MINIO_ROOT_PASSWORD ROAMLOG_IMAGE_TAG; do
  grep -qE "^${k}=.+" "$DST" && echo "  ok  $k" || echo "  MISSING $k"
done
echo "DONE"