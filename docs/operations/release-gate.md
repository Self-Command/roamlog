# Release gate and image publishing

## Triggers

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- `.github/workflows/release.yml` runs for `v*` tags and manual dispatches.
- A manual release dispatch defaults to `dry_run=true`, so it executes the full
  quality gate and builds every image without logging in to GHCR or pushing.

## Required gate

The reusable CI job must pass, in order:

1. frozen install
2. static staging/Docker/workflow validation
3. lint
4. typecheck
5. migrations and deterministic local seed
6. tests
7. contract and generated API client freshness
8. monorepo build
9. Playwright browser smoke
10. API smoke

No release image is built unless the whole quality gate succeeds.

## Dry run

In GitHub:

1. Open **Actions → Release gate → Run workflow**.
2. Keep `dry_run=true`.
3. Choose the branch/ref to verify.
4. Confirm each matrix entry (`api`, `migrate`, `worker`, `web`, `admin`) builds.

Equivalent local checks:

```bash
pnpm install --frozen-lockfile
pnpm staging:validate
pnpm lint
pnpm typecheck
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm contracts:check
pnpm build
pnpm e2e:api
```

Local Docker image builds require Docker BuildKit. Static checks do not prove
that images start; the release workflow's image builds and staging smoke checks
are separate evidence.

## Publishing

Tag release:

```bash
git tag v0.x.y
git push origin v0.x.y
```

Pushing a version tag publishes the runtime images and the migration image to
GHCR. The workflow attaches SHA and version tags. It does not deploy to a host.

Manual staging publication:

1. Dispatch **Release gate** with `dry_run=false`.
2. Set `image_tag=staging`.
3. Require a green quality gate and record the image digests.

The workflow uses `GITHUB_TOKEN` and the job-scoped `packages: write`
permission. No long-lived registry token is stored in the repository.

## Deploy published images to the server host

Resolve the release tag, for example `sha-1a2b3c4` or `v0.1.0-rc.3`. On the
single-host server deployment, compose already expects the GHCR names, so
pin `ROAMLOG_IMAGE_TAG` and pull with the server override:

```bash
export RELEASE_SHA=sha-1a2b3c4
export ROAMLOG_IMAGE_TAG="$RELEASE_SHA"

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

Use the same two-file server compose command for migration and application
startup. The loopback routes are `/`, `/admin/*`, `/admin-assets/*`, `/v1/*`,
and `/v1/ws`; see [deploy/README.md](../../deploy/README.md).

Required evidence before declaring deployment successful:

- quality-gate URL and run ID;
- image digests;
- migration job exit code `0`;
- `/v1/health` and `/v1/ready`;
- web, `/admin/login`, and an `/admin-assets/_next/*` static asset status;
- same-origin auth and Admin 2FA checks;
- admin 2FA gate;
- logs with no unresolved 5xx or email failures.

## Deploy limitations

- GHCR publishing is implemented; automatic host rollout is intentionally not
  because staging SSH/Railway/Fly credentials are not in this repository.
- The reverse proxy is a reviewed example, not an automatically managed
  container.
- k6 load gates, backups, external DNS, and monitoring credentials remain
  staging-operator responsibilities.
