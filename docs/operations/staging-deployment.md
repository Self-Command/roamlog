# Staging deployment

This runbook deploys the Roamlog monorepo to a single staging host with Docker
Compose. It is not a production deployment plan. Production should use the
managed services and provider split recorded in the full-stack design.

## Scope and safety rules

- Staging only. Never point these commands at production databases, buckets,
  domains, email audiences, or OAuth applications.
- Keep web, admin, and API on `https://*.staging.<domain>` under one staging
  parent domain. Do not reuse the production parent domain for staging cookies.
- Expose only the TLS ingress. Postgres and Redis have no host ports. MinIO,
  Mailpit, and app ports bind to `127.0.0.1` for a reverse proxy or SSH tunnel.
- Never run `prisma migrate reset`, seed demo data, or delete a volume against
  staging without a named change request and a current backup.

## Domain plan

| Surface | Example                             | Notes                                       |
| ------- | ----------------------------------- | ------------------------------------------- |
| Web     | `https://app.staging.roamlog.app`   | `APP_URL`                                   |
| Admin   | `https://admin.staging.roamlog.app` | `ADMIN_URL`                                 |
| API     | `https://api.staging.roamlog.app`   | `API_URL`, `BETTER_AUTH_URL`                |
| Media   | `https://media.staging.roamlog.app` | Optional CDN in front of the private bucket |

Use the exact web and admin origins in `CORS_ORIGINS`. Better Auth also derives
trusted origins from `APP_URL`, `ADMIN_URL`, `API_URL`, and `CORS_ORIGINS`.
Wildcards and credentials-on-any-origin are not acceptable.

## 1. Prepare secrets

```bash
cp docker/staging.env.example docker/.env.staging
chmod 600 docker/.env.staging
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -hex 32      # POSTGRES_PASSWORD and REDIS_PASSWORD
openssl rand -hex 32      # MINIO_ROOT_PASSWORD, S3_SECRET_KEY
```

Use URL-safe random values for `POSTGRES_PASSWORD` and `REDIS_PASSWORD`, or
percent-encode them before embedding in a URL. Prefer hexadecimal secrets so
Compose, Prisma, and Redis URLs do not need escaping.

Required identities:

- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`: bootstrap-only administrator.
- `S3_ACCESS_KEY` / `S3_SECRET_KEY`: dedicated application identity created by
  `docker/minio-init/01-create-bucket.sh` with access only to the one bucket.
- Resend API key or staging SMTP credentials. Do not send staging mail to real
  users without approval.
- OAuth credentials whose callback URLs point only to the staging API.

`docker/.env.staging` is ignored by Git. Never paste secret values into tickets,
chat, screenshots, audit metadata, or this repository.

### MinIO image availability

As of late 2026, the upstream MinIO community repository is archived and the
public Docker Hub images are gone. Anonymous Quay pulls are also gated. The
compose default therefore uses pinned Quay tags, not `latest`.

Before first startup, choose one approved source:

```bash
docker login quay.io
docker pull "$MINIO_IMAGE"
docker pull "$MINIO_MC_IMAGE"
```

If the organisation cannot pull from Quay, mirror the exact verified image
digest into its private registry and set `MINIO_IMAGE` / `MINIO_MC_IMAGE` to
those mirrored digests. Do not substitute an arbitrary third-party mirror.
Record the source digest in the deployment change. This is a real external
dependency risk, not a compose configuration detail.

## 2. Validate configuration

Run static checks before asking Docker to pull or build:

```bash
pnpm staging:validate
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml config >/tmp/roamlog-staging.compose.yml
```

The bootstrap dry run runs inside the API image after startup; use section 6.

## 3. Build and start

For a source build:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app up -d --build
```

Infrastructure only:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile infra up -d
```

The `app` profile includes Postgres, Redis, MinIO, Mailpit, the one-shot
migration job, API, worker, web, and admin. The migration job must complete
before API and worker start.

For a release image deployed from GHCR, see
[release-gate.md](./release-gate.md). Pull and retag the immutable images before
the final `up --no-build`.

## 4. Reverse proxy, TLS, and headers

`docker/Caddyfile.staging.example` is a starting point for Caddy on the staging
host. It terminates TLS, proxies loopback ports, applies HSTS and a CSP, and
blocks public access to `/v1/metrics`.

Header requirements:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` only after
  the staging certificate and redirect are verified. Do not enable `preload`
  for a disposable staging domain.
- CSP must cover Next.js inline bootstrap styles/scripts. The example uses
  `'unsafe-inline'`; a nonce-based CSP is a hardening task because it requires
  application middleware changes.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`.
- Do not cache responses containing `Set-Cookie`, authentication state, admin
  data, or signed media URLs.

Session cookies:

- `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`.
- Use `SESSION_COOKIE_DOMAIN=.staging.<domain>` only with HTTPS and a parent
  domain dedicated to staging.
- Do not set a cookie domain for localhost, IP addresses, or unrelated domains.

CORS:

- Exact origins for web and admin only.
- Credentials enabled.
- No wildcard, null origin, or partial suffix matching.

## 5. Migrations

The normal `app` profile runs:

```bash
prisma migrate deploy
```

in the one-shot `migrate` service. To rerun or inspect a migration manually:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm migrate
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm --entrypoint sh migrate -lc \
  'cd /app/node_modules/@roamlog/db && prisma migrate status'
```

Follow [migrations.md](./migrations.md) for backups, drift checks, and rollback
limits.

## 6. Bootstrap the first `super_admin`

The bootstrap CLI is deliberately two-stage:

1. If the account does not exist, it creates a Better Auth email/password
   identity with a generated credential that is never printed and sends a
   verification email plus a one-time password-reset email. The account remains
   platform role `user`.
2. The operator verifies email, sets a strong password through the reset link,
   signs in, opens `/admin/2fa/enroll`, and verifies TOTP.
3. Rerun bootstrap. Only an active account with verified email and verified TOTP
   is promoted to `super_admin`, with a system audit entry.

Dry run inside the API image:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm --no-deps --entrypoint tsx api \
  scripts/bootstrap-admin.ts --dry-run
```

Create the invitation:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app run --rm --entrypoint tsx api \
  scripts/bootstrap-admin.ts --force
```

The command exits `2` if the account exists but email delivery evidence is
incomplete. Inspect `EmailLog` and Mailpit/Resend. Do not claim success when the
output says `account_created_delivery_incomplete`.

After TOTP enrollment, rerun the same `--force` command. Expected statuses:

- `promoted`: role changed from `user`/other platform role to `super_admin`.
- `already_bootstrapped`: the account was already a 2FA-verified super admin.
- Error containing `verified TOTP factor`: no promotion happened.

Mailpit is available only through an SSH tunnel:

```bash
ssh -L 18025:127.0.0.1:18025 staging-host
```

Then open `http://127.0.0.1:18025`.

## 7. Smoke checks

```bash
curl -fsS https://api.staging.roamlog.app/v1/health
curl -fsS https://api.staging.roamlog.app/v1/ready
curl -fsS -o /dev/null -w '%{http_code}\n' https://app.staging.roamlog.app/login
curl -fsS -o /dev/null -w '%{http_code}\n' https://admin.staging.roamlog.app/login
```

Expected:

- health: `{"status":"ok"}`.
- ready: HTTP 200 with database, Redis, and storage all `up`.
- web/admin login pages: 200 after TLS redirect.
- unauthenticated `/v1/admin/metrics`: 401.
- direct public `/v1/metrics`: 404 at the ingress.
- platform admin without TOTP: `403 ADMIN_2FA_REQUIRED`.
- first super admin: verified TOTP required on sign-in.

Then verify one email, one media upload, one queue-backed operation, and audit
visibility. Check logs for 5xx and `email.delivery_failed`.

## 8. Seed data

The staging compose does not seed automatically. The current seed guard refuses
`NODE_ENV=production`, so enabling demo users requires a separate product/data
decision and code change. Do not bypass the guard by running staging as
`NODE_ENV=development`.

## 9. Shutdown

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app stop
```

Do not remove named volumes unless a current backup exists and the data-loss
decision is explicit.
