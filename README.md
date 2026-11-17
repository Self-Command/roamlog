# Roamlog

Roamlog is a collaborative travel journal. This repository contains the
full-stack implementation; `../roamlog-prototype` remains the visual/interaction
reference rather than production code.

## Current stage

- API, worker, database, auth, admin, realtime, media, email, and operations
  surfaces are implemented and under integration hardening.
- Web and Admin keep deterministic local/mock modes and also support real API
  mode. The staging Docker builds set `NEXT_PUBLIC_DATA_MODE=api` and
  `NEXT_PUBLIC_ADMIN_DATA_MODE=api`.
- Staging deployment, migrations, backup/restore, rollback, secret rotation,
  health monitoring, troubleshooting, CI gates, and image publishing are
  documented under `docs/operations/`.
- Full production readiness is still gated by external staging services, TLS,
  managed backups, load/security verification, and the remaining checklist in
  the full-stack design.

## Requirements

- Node.js 24.x
- pnpm 12.x
- Docker Engine + Compose for containerized local/staging runs
- Python 3 + PyYAML for `staging:validate`

## Local development

```bash
cp .env.example .env.local
pnpm install
docker compose --env-file .env.local -f docker/compose.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Local services:

- Web: `http://localhost:3000`
- Admin: `http://localhost:3001`
- API: `http://localhost:4000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO: `http://localhost:9000`, console `http://localhost:9001`
- Mailpit: `http://localhost:8025`

The current MinIO community image is not anonymously pullable. Set
`MINIO_IMAGE` / `MINIO_MC_IMAGE` to an authenticated or privately mirrored
pinned digest before starting from a clean host. See
[staging deployment](docs/operations/staging-deployment.md).

## Common commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm contracts:check
pnpm check:env
pnpm e2e
pnpm e2e:live
pnpm staging:validate
```

## Staging

```bash
cp docker/staging.env.example docker/.env.staging
pnpm staging:validate
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml config
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app up -d --build
```

The staging stack includes hardened, non-root API/worker/web/admin images, a
one-shot Prisma migration image, PostgreSQL, authenticated Redis, private MinIO,
and Mailpit. Only loopback ports are published; a TLS ingress must provide
HSTS/CSP and restrict `/v1/metrics`.

Deployment, release, migration, backup, rollback, and incident procedures:

- [Operations index](docs/operations/README.md)
- [Staging deployment](docs/operations/staging-deployment.md)
- [Release gate](docs/operations/release-gate.md)

## First platform administrator

The bootstrap command is two-stage and never prints the generated initial
credential:

```bash
pnpm admin:bootstrap -- --dry-run
pnpm admin:bootstrap -- --force
# verify email, set password, enroll TOTP at /admin/2fa/enroll
pnpm admin:bootstrap -- --force
```

A missing account starts as platform role `user`. Promotion to `super_admin`
requires an active account, verified email, and verified TOTP; otherwise the
command fails without changing the role. See
[staging deployment](docs/operations/staging-deployment.md#6-bootstrap-the-first-super_admin).

## Contracts and boundaries

- `packages/contracts` is the source of truth for Zod/OpenAPI/realtime/permission
  contracts.
- `packages/api-client` is generated; do not hand-edit it.
- `packages/db` owns Prisma schema, migrations, seed, and test factories.
- Business queries carry `workspaceId` and validate membership before access.
- Seed is local/staging-only and the production guard is intentional.

## Security

Never commit `.env`, `.env.local`, `.env.staging`, real credentials, tokens,
database dumps, or user data. Public share tokens are stored only as hashes;
plaintext is returned once at creation. Admin access requires platform role and
verified TOTP.
