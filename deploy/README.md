# Roamlog production server deployment

This is the deployment runbook for the single-host production origin
`https://we.spacedo.org`. The Compose files retain `staging` in their names for
compatibility; the two-file server stack is the deployed application:

```text
docker/compose.staging.yml
docker/compose.server.yml
```

Caddy is not used on this host. Host Nginx terminates TLS and forwards only the
required loopback routes to Docker Compose.

## Topology

| Surface       | Public origin                           | Loopback upstream         |
| ------------- | --------------------------------------- | ------------------------- |
| Web           | `https://we.spacedo.org/`               | `127.0.0.1:13000`         |
| Admin pages   | `https://we.spacedo.org/admin/*`        | `127.0.0.1:13001`         |
| Admin assets  | `https://we.spacedo.org/admin-assets/*` | `127.0.0.1:13001/_next/*` |
| API           | `https://we.spacedo.org/v1/*`           | `127.0.0.1:14000`         |
| Realtime      | `wss://we.spacedo.org/v1/ws`            | `127.0.0.1:14000`         |
| MinIO S3      | private, container network only         | `127.0.0.1:19000`         |
| MinIO console | SSH tunnel only                         | `127.0.0.1:19001`         |
| Mailpit       | SSH tunnel only                         | `127.0.0.1:18025`         |

Only TCP 80 and 443 are public. PostgreSQL and Redis have no host ports.
The web, admin, and API loopback ports must never be exposed directly to the
internet.

## Edge and proxy trust

The supported path is:

```text
Internet -> Cloudflare (if enabled) -> host Nginx :443 -> loopback app ports
```

- Use Cloudflare **Full (strict)** TLS to the origin, or disable Cloudflare
  proxying and use Nginx as the sole public edge. Do not use Flexible or
  End-to-end modes that terminate TLS in an untrusted position.
- If Cloudflare proxies the hostname, restrict origin TCP 80/443 to Cloudflare's
  published IP ranges and keep the origin certificate valid. Do not leave an
  alternate DNS record or direct IP path open.
- Install Cloudflare's published ranges into
  `/etc/nginx/snippets/cloudflare-realip.conf` and set
  `real_ip_header CF-Connecting-IP`. Never use `0.0.0.0/0` or another broad
  `set_real_ip_from` rule.
- Nginx is the only proxy trusted by the application. The API has a one-hop
  `trust proxy` setting (`TRUST_PROXY=true` maps to one proxy), so do not add a
  second app proxy, a service mesh, or a direct loopback bypass. Only Nginx may
  send `X-Forwarded-*` headers to the API.
- Nginx blocks `GET /v1/metrics` with `404`. Postgres, Redis, MinIO, and Mailpit
  remain private.

## Host layout

```text
/opt/roamlog/
  bin/backup-roamlog.sh
  config/.env.staging
  config/image-digests.txt
  data/postgres
  data/redis
  data/minio
  backups/
  logs/
  repo/
```

Create the deployment env file from the template on the host, then fill every
placeholder from the approved secret store. Do not copy a populated env file
into Git or a ticket:

```bash
install -d -m 700 /opt/roamlog/config
install -m 600 docker/staging.env.example /opt/roamlog/config/.env.staging
```

Use same-origin public values. The exact auth callback, CORS, and cookie values
must be reviewed by the API owner before enabling traffic; do not infer them
from a subdomain deployment:

```text
APP_URL=https://we.spacedo.org
ADMIN_URL=https://we.spacedo.org/admin
API_URL=https://we.spacedo.org
BETTER_AUTH_URL=https://we.spacedo.org
CORS_ORIGINS=https://we.spacedo.org
SESSION_COOKIE_DOMAIN=.we.spacedo.org
```

Admin uses the same origin with build-time asset prefix `/admin-assets` and login
path `/admin/login`. The Admin env/build values must remain aligned with the
release image.

## Compose command

Always apply both files and the same env path:

```bash
cd /opt/roamlog/repo
docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app config --quiet
```

The server override replaces named data volumes with the bind mounts under
`/opt/roamlog/data`, so a compose command without
`docker/compose.server.yml` is not the production deployment.

## First-time Nginx and TLS

1. Back up `/etc/nginx`.
2. Install `deploy/nginx/roamlog.conf.example` as
   `/etc/nginx/sites-available/roamlog` and link it into `sites-enabled`.
3. Install `deploy/nginx/cloudflare-realip.conf.example` as
   `/etc/nginx/snippets/cloudflare-realip.conf`. If Cloudflare proxies the
   origin, add only its current published ranges; if it does not, keep the file
   without `set_real_ip_from` entries. The example intentionally does not ship a
   broad trust range.
4. Issue the certificate through Nginx:

```bash
certbot --nginx -d we.spacedo.org \
  --non-interactive --agree-tos --redirect
```

5. Run `nginx -t` and reload Nginx.
6. Pull the release images and start the app profile.
7. Verify the routes and headers in
   [production-smoke-checklist.md](../docs/operations/production-smoke-checklist.md).

The Nginx server block handles only `we.spacedo.org`. Admin page paths stay under
`/admin/*`; `/admin-assets/<asset>` is rewritten to `/_next/<asset>` only for
the Admin upstream. Web's root `/_next/*` namespace is not shared with Admin.

## Deploy a published RC

The release gate builds and publishes five GHCR images after the CI quality gate
passes. For a tag such as `v0.1.0-rc.3`, verify the release and digest list
first, then pin the same tag for every Compose service:

```bash
cd /opt/roamlog/repo
export ROAMLOG_IMAGE_TAG=v0.1.0-rc.3

docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app pull migrate api worker web admin

docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app up -d --no-build
```

Do not use `--build` for a release deployment. Record the tag and all five
digests in `config/image-digests.txt`. The migration service must exit `0`
before API and worker become healthy; inspect its logs and `/v1/ready` before
declaring success.

Release workflow details and failure recovery are in
[release-runbook.md](../docs/releases/release-runbook.md).

## Bootstrap

Bootstrap is intentionally two-stage. Run it only with the same server compose
files:

```bash
docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app run --rm --no-deps --entrypoint tsx api \
  scripts/bootstrap-admin.ts --force
```

The command creates an unverified account and sends verification and reset
messages through the configured mail provider. After email verification,
password setup, and TOTP enrollment, run the same command again. Promotion to
`super_admin` is refused until both email and TOTP are verified.

For the isolated staging Mailpit tunnel, use the host alias rather than a
hard-coded address:

```bash
ssh -L 18025:127.0.0.1:18025 root@we.spacedo.org
```

Production should use the approved Resend/SMTP provider, not Mailpit.

## Backups

Install and run the production backup job:

```bash
install -d -m 700 /opt/roamlog/bin
install -m 700 deploy/backup-roamlog.sh /opt/roamlog/bin/backup-roamlog.sh
BACKUP_RETENTION_DAYS=14 /opt/roamlog/bin/backup-roamlog.sh
```

The script writes a PostgreSQL custom-format dump, a private MinIO mirror, and
a `0600` env copy into a `0700` timestamped directory under
`/opt/roamlog/backups`. It prunes only completed runs older than the configured
retention period. It does not install cron or systemd units.

See [production backup and restore](../docs/operations/production-backup-restore.md)
for verification, isolated restore, and drill requirements.

## Known integration gap

The API currently signs S3 URLs with the internal `http://minio:9000` endpoint.
Public uploads and private media reads therefore need either a dedicated TLS
media origin or an API-side public storage endpoint. This deployment keeps the
S3 service private and records the gap rather than weakening object storage
authorization.
