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

echo "MinIO bucket '$S3_BUCKET' is ready (private, least-privilege application identity)."
