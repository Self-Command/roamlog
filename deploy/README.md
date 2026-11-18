# Roamlog server deployment

This directory documents the persistent single-host staging deployment for
Roamlog. It uses host Nginx for TLS ingress and Docker Compose for application
containers. Caddy is not used on this host.

## Topology

| Surface | Public origin | Loopback upstream |
| --- | --- | --- |
| Web | `https://we.spacedo.org/` | `127.0.0.1:13000` |
| Admin | `https://we.spacedo.org/admin/*` | `127.0.0.1:13001` |
| Admin assets | `https://we.spacedo.org/admin-assets/*` | `127.0.0.1:13001/_next/*` |
| API | `https://we.spacedo.org/v1/*` | `127.0.0.1:14000` |
| MinIO S3 | private, container network only | `127.0.0.1:19000` |
| MinIO console | SSH tunnel only | `127.0.0.1:19001` |
| Mailpit | SSH tunnel only | `127.0.0.1:18025` |

Only TCP 80 and 443 are public. PostgreSQL and Redis have no host ports.

## Host layout

```text
/opt/roamlog/
  config/.env.staging
  config/image-digests.txt
  config/deploy-roamlog.sh
  data/postgres
  data/redis
  data/minio
  backups/
  logs/
  repo/
```

The compose override is `docker/compose.server.yml`. It is applied on top of
`docker/compose.staging.yml`:

```bash
cd /opt/roamlog/repo
export ROAMLOG_STAGING_ENV_FILE=/opt/roamlog/config/.env.staging
docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app config
```

## Image policy

Application images are pulled anonymously from:

```text
ghcr.io/self-command/roamlog/{api,migrate,worker,web,admin}:${ROAMLOG_IMAGE_TAG}
```

The release tag is immutable by convention. Record the resolved top-level
manifest digest for every component in `config/image-digests.txt`.

MinIO community images are no longer anonymously pullable from Quay or Docker
Hub. This deployment pins Chainguard's reproducible MinIO server and client
images by OCI digest. The `minio-init` image is assembled locally from those
pinned inputs plus the repository's least-privilege bucket script; it is not a
replacement object store.

## First-time TLS and startup

1. Back up `/etc/nginx`.
2. Install `deploy/nginx/roamlog.conf.example` to
   `/etc/nginx/sites-available/roamlog` and link it into `sites-enabled`.
3. Issue the certificate through the Nginx plugin:

```bash
certbot --nginx -d we.spacedo.org \
  --non-interactive --agree-tos --redirect
```

4. Run `nginx -t` and reload Nginx.
5. Pull the release images and start the compose project.
6. Verify `/v1/health`, `/v1/ready`, `/login`, and `/admin/login` over HTTPS.

The Nginx server block only handles `we.spacedo.org`. Existing sites are not
modified. The public API returns 404 for `/v1/metrics`. Admin page paths are
preserved under `/admin/*`; `/admin-assets/<asset>` is rewritten to
`/<asset>` so a Next.js request such as
`/admin-assets/_next/static/app.js` reaches `/_next/static/app.js`.

## Bootstrap

Bootstrap is intentionally two-stage:

```bash
docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app run --rm --no-deps --entrypoint tsx api \
  scripts/bootstrap-admin.ts --force
```

The command creates an unverified account and sends verification and reset
messages to Mailpit. After email verification, password setup, and TOTP
enrollment, run the same command again. Promotion to `super_admin` is refused
until both email and TOTP are verified.

Mailpit is reachable only through an SSH tunnel:

```bash
ssh -L 18025:127.0.0.1:18025 root@217.217.197.188
```

## Demo fixtures

The staging seed guard rejects `NODE_ENV=production`. For a public demo, use a
one-shot seed container with explicit staging fixtures and the same database and
bucket. Do not run the API or worker with `NODE_ENV=development`, and do not use
real personal data.

## Backups

`/opt/roamlog/backups/backup-roamlog.sh` writes a PostgreSQL custom-format dump,
Redis snapshot, and MinIO mirror into a timestamped directory. It is safe to run
manually. Schedule it with the host's approved scheduler after operational
approval; this task does not modify host cron or systemd.

## Known integration gap

The API currently signs S3 URLs with the internal `http://minio:9000` endpoint.
Public uploads and private media reads therefore need either a dedicated TLS
media origin or an API-side public storage endpoint. This deployment keeps the
S3 service private and records the gap rather than weakening object storage
authorization.
