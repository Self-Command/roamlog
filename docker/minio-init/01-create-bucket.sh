#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

case "$S3_BUCKET" in
  *[!a-z0-9.-]* | .* | -* | *.)
    echo "S3_BUCKET must be a valid lowercase S3-compatible bucket name." >&2
    exit 1
    ;;
esac

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"

# ---------------------------------------------------------------------------
# Bucket CORS
#
# Browsers reach media through the public media host (Nginx -> MinIO), which is
# a different origin than the web app, so direct PUT uploads and <img> reads are
# cross-origin. MinIO answers CORS preflight from the per-bucket policy below;
# the API's presigned URLs are unchanged by this.
#
# MEDIA_CORS_ORIGINS is a comma-separated list of bare origins. The default keeps
# local development usable; production sets the real app origin(s).
# ---------------------------------------------------------------------------
MEDIA_CORS_ORIGINS="${MEDIA_CORS_ORIGINS:-http://localhost:3000}"

trim_origin() {
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

cors_file="/tmp/roamlog-bucket-cors.xml"
cors_applied_file="/tmp/roamlog-bucket-cors-applied.json"
first_origin=""
origin_count=0

{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<CORSConfiguration>'

  old_ifs="$IFS"
  IFS=','
  for raw_origin in $MEDIA_CORS_ORIGINS; do
    origin="$(trim_origin "$raw_origin")"
    if [ -z "$origin" ]; then
      continue
    fi

    case "$origin" in
      http://* | https://*) ;;
      *)
        echo "MEDIA_CORS_ORIGINS entries must be http(s) origins; one entry is not." >&2
        exit 1
        ;;
    esac

    # Bare origins only: a path would never match the Origin header, and the
    # character whitelist keeps the generated XML well-formed.
    origin_without_scheme="${origin#*://}"
    case "$origin_without_scheme" in
      */* | *\?* | *" "* | *[!A-Za-z0-9._:/-]* | "")
        echo "MEDIA_CORS_ORIGINS entries must be bare origins such as https://we.example.com (no path or query), and contain only URL-safe characters." >&2
        exit 1
        ;;
    esac

    origin_count=$((origin_count + 1))
    if [ -z "$first_origin" ]; then
      first_origin="$origin"
    fi

    echo '  <CORSRule>'
    echo "    <AllowedOrigin>${origin}</AllowedOrigin>"
    echo '    <AllowedMethod>GET</AllowedMethod>'
    echo '    <AllowedMethod>PUT</AllowedMethod>'
    echo '    <AllowedMethod>HEAD</AllowedMethod>'
    echo '    <AllowedHeader>*</AllowedHeader>'
    echo '    <ExposeHeader>ETag</ExposeHeader>'
    echo '    <MaxAgeSeconds>3000</MaxAgeSeconds>'
    echo '  </CORSRule>'
  done
  IFS="$old_ifs"

  echo '</CORSConfiguration>'
} >"$cors_file"

if [ "$origin_count" -eq 0 ]; then
  echo "MEDIA_CORS_ORIGINS must list at least one origin." >&2
  exit 1
fi

# `mc cors set` replaces the policy, so re-running this script converges.
if ! mc cors set "local/$S3_BUCKET" "$cors_file"; then
  echo "Failed to apply bucket CORS to '$S3_BUCKET'." >&2
  exit 1
fi

# Read it back: a silent partial apply would surface later as browser CORS
# failures on upload/read, which are hard to diagnose from the API logs.
if ! mc cors get "local/$S3_BUCKET" >"$cors_applied_file" 2>&1; then
  echo "Bucket CORS was set but could not be read back for '$S3_BUCKET'." >&2
  cat "$cors_applied_file" >&2 || true
  exit 1
fi

if ! grep -F -q "$first_origin" "$cors_applied_file"; then
  echo "Bucket CORS read-back does not contain the configured origins; refusing to report success." >&2
  cat "$cors_applied_file" >&2 || true
  exit 1
fi

if [ "$S3_ACCESS_KEY" != "$MINIO_ROOT_USER" ]; then
  if ! mc admin user info local "$S3_ACCESS_KEY" >/dev/null 2>&1; then
    mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
  fi

  policy_file="/tmp/roamlog-bucket-rw.json"
  cat >"$policy_file" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::${S3_BUCKET}"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::${S3_BUCKET}/*"]
    }
  ]
}
EOF

  if ! mc admin policy info local roamlog-bucket-rw >/dev/null 2>&1; then
    mc admin policy create local roamlog-bucket-rw "$policy_file"
  fi
  mc admin policy attach local roamlog-bucket-rw --user "$S3_ACCESS_KEY"
  rm -f "$policy_file"
fi

rm -f "$cors_file" "$cors_applied_file"

echo "MinIO bucket '$S3_BUCKET' is ready (private, least-privilege application identity, browser CORS for ${origin_count} origin(s))."