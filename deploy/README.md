# Roamlog production server deployment

This is the deployment runbook for the single-host production origin
`https://we.spacedo.org`. The production stack is one standalone Compose file:

```text
docker/compose.production.yml
```

The older two-file stack is **legacy staging** and is kept only so the existing
environment keeps working:

```text
docker/compose.staging.yml    # legacy staging base (builds images, runs Mailpit)
docker/compose.server.yml     # legacy staging server override (GHCR images, bind mounts)
```

Rules of thumb:

- Production uses `docker/compose.production.yml` with
  `/opt/roamlog/config/.env.production`. Its project name is `roamlog`.
- Do not layer `compose.production.yml` on top of the legacy pair. The legacy
  pair keeps `name: roamlog-staging`, starts a Mailpit container, and is not a
  production deployment.
- `compose.staging.yml` and `compose.server.yml` are intentionally not deleted.
  Treat every `staging` path, port, and env example in the legacy sections below
  as staging-only.
- Production mail is a real provider (Resend or SMTP), never Mailpit. See
  [email-production.md](../docs/operations/email-production.md).

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
| Mailpit       | legacy staging only, never production   | `127.0.0.1:18025`         |

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
- Nginx blocks `GET /v1/metrics` with `404`. Postgres, Redis, and MinIO remain
  private in production. Mailpit exists only in the legacy staging stack and is
  never exposed by the production runbook.

## Host layout

```text
/opt/roamlog/
  bin/backup-roamlog.sh
  config/.env.production
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
install -m 600 docker/production.env.example /opt/roamlog/config/.env.production
```

The API validates this file at boot. `APP_ENV=production`, a real
`EMAIL_PROVIDER`, and a non-`.local` `EMAIL_FROM` are mandatory; see
[email-production.md](../docs/operations/email-production.md) for the mail half
of the checklist.

Preflight the file before any deploy command. The check is read-only, calls the
same `validateEnvironment()` the API runs, and never prints a value:

```bash
cd /opt/roamlog/repo
pnpm check:env -- --env production --env-file /opt/roamlog/config/.env.production
```

Exit `0` means the file is complete and still contains no `CHANGE_ME`
placeholder. The unmodified template is expected to exit `1`; that is how the
preflight proves the template is not deployable as-is.

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

Admin uses the same origin with asset prefix `/admin-assets` and login path
`/admin/login`. These values must be present during both `next build` and
`next start`: Next re-evaluates `next.config.ts` at runtime, and a missing
runtime value makes part of the server-rendered HTML request root `/_next/*`
from the Web container. `docker/admin.Dockerfile` declares matching defaults in
the build and runtime stages.

## Compose command

Always use the production file and the production env path:

```bash
cd /opt/roamlog/repo
docker compose \
  --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml \
  config --quiet
```

`compose.production.yml` is standalone: it already contains the GHCR images, the
`/opt/roamlog/data/*` bind mounts, and the loopback-only ports. There is no
override file to apply and no `--profile` to select.

Legacy staging keeps the two-file form and the `.env.staging` path; only use it
for the staging environment:

```bash
docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app config --quiet
```

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
After deployment, run `pnpm admin:verify-assets https://we.spacedo.org`; it must
report `ok: true` with zero root `/_next` URLs.

## Deploy a published RC

The release gate builds and publishes five GHCR images after the CI quality gate
passes. For a tag such as `v0.1.0-rc.3`, verify the release and digest list
first, then pin the same tag for every Compose service:

```bash
cd /opt/roamlog/repo
export ROAMLOG_IMAGE_TAG=v0.1.0-rc.3

docker compose \
  --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml \
  pull migrate api worker web admin

docker compose \
  --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml \
  up -d --no-build
```

The tag is also read from `ROAMLOG_IMAGE_TAG` in the env file; the shell export
above simply wins for the current session. Every image reference in
`compose.production.yml` uses `${ROAMLOG_IMAGE_TAG:?}`, so a missing tag aborts
before anything is pulled.

Do not use `--build` for a release deployment. Record the tag and all five
digests in `config/image-digests.txt`. The migration service must exit `0`
before API and worker become healthy; inspect its logs and `/v1/ready` before
declaring success.

Release workflow details and failure recovery are in
[release-runbook.md](../docs/releases/release-runbook.md).

## Bootstrap

Bootstrap is intentionally two-stage. Run it only with the production compose
file:

```bash
docker compose \
  --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml \
  run --rm --no-deps --entrypoint tsx api \
  scripts/bootstrap-admin.ts --force
```

The command creates an unverified account and sends verification and reset
messages through the configured mail provider. After email verification,
password setup, and TOTP enrollment, run the same command again. Promotion to
`super_admin` is refused until both email and TOTP are verified.

Production should send through the approved Resend/SMTP provider. Mailpit is
not part of `compose.production.yml`; the API refuses to start with
`EMAIL_PROVIDER=mailpit` when `APP_ENV=production`. For the legacy staging
catcher only, use the host alias rather than a hard-coded address:

```bash
ssh -L 18025:127.0.0.1:18025 root@we.spacedo.org
```

Mail delivery, DNS checks, and rollback are documented in
[email-production.md](../docs/operations/email-production.md).

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

## Legacy staging stack (not production)

`docker/compose.staging.yml` plus `docker/compose.server.yml` still describe the
pre-production environment (`name: roamlog-staging`). They are kept so the
running staging host is not broken, and are intentionally not deleted. They are
frozen in place for production purposes:

- They start a Mailpit container; production mail must be a real provider.
- They build local images by default; production pulls only GHCR release images
  pinned by `ROAMLOG_IMAGE_TAG`. Local staging builds must pass
  `--build-arg NEXT_PUBLIC_APP_ENV=staging` (or the matching `build.args`
  entry); `docker/web.Dockerfile` and `docker/admin.Dockerfile` default that arg
  to `production`, because the base image sets `NODE_ENV=production` and the
  Admin badge would otherwise claim `PRODUCTION` on staging.
  `NEXT_PUBLIC_DATA_MODE` / `NEXT_PUBLIC_ADMIN_DATA_MODE` 已移除，应用只有真实
  API 路径，因此 staging 与 production 镜像都不再接受 data-mode build arg。
- They read `/opt/roamlog/config/.env.staging`, which does not carry the
  production mail validation contract (`APP_ENV=production`,
  `EMAIL_PROVIDER=resend|smtp`).

Migrating a host from the legacy pair to production is a compose-file swap plus
a new env file: copy `docker/production.env.example` to
`/opt/roamlog/config/.env.production`, fill it, then run the production command
from "Compose command" above. Do not run both stacks against the same data
directories.

## Media delivery: two endpoints, not a gap

The API uses two storage endpoints on purpose, and production sets both:

| Endpoint             | Value in production      | Used for                                                          |
| -------------------- | ------------------------ | ----------------------------------------------------------------- |
| `S3_ENDPOINT`        | `http://minio:9000`      | server-side S3 calls: health, head, delete, bucket checks         |
| `S3_PUBLIC_ENDPOINT` | `https://media.<domain>` | SigV4 presigning only (GET reads, PUT uploads handed to browsers) |

SigV4 signs the `Host` header, so the browser-facing URL must be signed against
the host the browser will actually call. Writing the internal `minio:9000` host
into a presigned URL would produce a 403 in every browser, even though the API
itself can reach MinIO. Nginx therefore terminates TLS for the media host and
must forward the original `Host` header to MinIO — see
[deploy/nginx/media.conf.example](nginx/media.conf.example), which keeps
`proxy_set_header Host $host;`.

With `APP_ENV=production` the API refuses to boot when `S3_PUBLIC_ENDPOINT` is
missing or is not a public https origin without a path, and
`compose.production.yml` requires the variable at `docker compose config` time.
The bucket CORS policy for cross-origin reads/uploads is derived from
`MEDIA_CORS_ORIGINS` by the `minio-init` one-shot service.

The full contract — validation rules, TTL limits, CORS, rotation between media
hosts, and signature-mismatch triage — is in
[docs/operations/media-delivery.md](../docs/operations/media-delivery.md). This
section replaces the earlier "Known integration gap" note, which described the
pre-`S3_PUBLIC_ENDPOINT` behaviour and is no longer true.
