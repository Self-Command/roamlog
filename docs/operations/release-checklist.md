# Release checklist — rc.4

Pre-release gate for the next production cut. Work top to bottom; a failed item
stops the release. Record the command output (or a hash of it) in the release
ticket or `.audit/` evidence — "it looked fine" is not evidence.

Placeholders in angle brackets are deliberate. **Never paste a real domain
credential, API key, SMTP password, or `re_...` key into this file, a ticket, or
chat.** Commands read secrets from `/opt/roamlog/config/.env.production`
(`0600`) or the approved secret store.

Reference runbooks: [media delivery](./media-delivery.md),
[email delivery](./email-production.md),
[production smoke checklist](./production-smoke-checklist.md),
[backup and restore](./production-backup-restore.md), [rollback](./rollback.md),
[release gate](./release-gate.md).

---

## 0. Preconditions

| Check                                        | Command                                                   | Pass criteria                                    |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Clean working tree on the release commit     | `git status --porcelain`                                  | empty output; release commit is the one CI built |
| No pending CodeGraph drift (repo convention) | `codegraph status`                                        | `[OK] Index is up to date`                       |
| Node / pnpm match `package.json`             | `node -v && pnpm -v`                                      | Node 24.x, pnpm 12.x                             |
| Host has the release repo checked out        | `test -f /opt/roamlog/repo/docker/compose.production.yml` | file exists                                      |

Do not run any step below against a host whose `/opt/roamlog/config/.env.production`
is missing or older than the release commit.

---

## 1. Environment variable preflight

The preflight is read-only, reuses `validateEnvironment()` from
`apps/api/src/config/environment.ts`, and never prints a value.

| #   | Check                       | Command                                                                             | Pass criteria                                                |
| --- | --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Production env file         | `pnpm check:env -- --env production --env-file /opt/roamlog/config/.env.production` | exit `0`, no `ERROR:` line, no `WARN:` about placeholders    |
| 2   | Local env file (dev sanity) | `pnpm check:env`                                                                    | exit `0`; placeholder `WARN:` lines are expected locally     |
| 3   | Strictness is still real    | `pnpm check:env -- --env production` (unmodified template)                          | exit `1` — the template carries `CHANGE_ME`, so it must fail |
| 4   | Key set unchanged           | `grep -cE '^(APP_ENV                                                                | EMAIL_PROVIDER                                               | S3_PUBLIC_ENDPOINT | S3_PUBLIC_BASE_URL | MEDIA_SIGNED_URL_TTL_SECONDS | MEDIA_CORS_ORIGINS)=' /opt/roamlog/config/.env.production` | prints `6` (or `5` if `S3_PUBLIC_BASE_URL` is intentionally left unset) |

Rules the preflight enforces (all must hold, they are named in any error line):

- `APP_ENV=production` is **explicit**. Omitting it silently falls back to
  `development` and disables the production media/mail rules.
- `EMAIL_PROVIDER` is explicit and not `mailpit`. `resend` needs a real `re_...`
  key and an empty `SMTP_HOST`; `smtp` needs a non-local host, a port other than
  `1025`, user and password.
- `EMAIL_FROM` is `Name <local@domain>` on a verified domain, never `.local`.
- `S3_PUBLIC_ENDPOINT` is a public `https:` origin without a path, credentials,
  `minio`/`localhost`/private IP, or placeholder.
- `MEDIA_CORS_ORIGINS` lists bare origins and includes the `APP_URL` origin.
- `MEDIA_SIGNED_URL_TTL_SECONDS` is an integer in `60`–`604800`.
- `BETTER_AUTH_SECRET` has at least 32 characters and no placeholder.

Copy the `ERROR:` lines verbatim into the ticket if this step fails. They name
the variable and the rule; they never contain the value.

---

## 2. Contract and generated-client freshness

| Check                      | Command                | Pass criteria                                       |
| -------------------------- | ---------------------- | --------------------------------------------------- |
| Contracts and Orval client | `pnpm contracts:check` | exit `0`; no "generated files are out of date" diff |

Run `pnpm contracts:generate` only if the check fails **and** the OpenAPI change
is part of this release. Otherwise the change is unrelated drift — stop and
investigate.

---

## 3. Typecheck

| Check          | Command                                | Pass criteria                    |
| -------------- | -------------------------------------- | -------------------------------- |
| Whole monorepo | `pnpm typecheck`                       | exit `0`, zero TypeScript errors |
| API only       | `pnpm --filter @roamlog/api typecheck` | exit `0`                         |

A pre-existing error in an unrelated in-flight module is **not** acceptable
unless the release commit predates it and the failure is documented with the
exact error text; prefer rebasing onto a green commit.

---

## 4. Tests

| Check              | Command                                                  | Pass criteria                                                   |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| Unit / integration | `pnpm test`                                              | exit `0`; no skipped suite that covers media/auth               |
| Auth and tenancy   | `pnpm test --filter @roamlog/api` (or the CI equivalent) | exit `0`; tenant isolation and object-level authz suites passed |

Warnings are allowed; failures, unhandled rejections, and "0 tests" are not.

---

## 5. Build

| Check          | Command      | Pass criteria                                                    |
| -------------- | ------------ | ---------------------------------------------------------------- |
| Monorepo build | `pnpm build` | exit `0`; web and admin produce `.next/`; no missing-env warning |

Confirm the deployment identity is baked at build time, not runtime:

```bash
grep -n NEXT_PUBLIC_APP_ENV docker/web.Dockerfile docker/admin.Dockerfile
```

Pass criteria: both files declare `ARG NEXT_PUBLIC_APP_ENV=production` in the
`build` stage and propagate it through `ENV`. Next.js inlines
`NEXT_PUBLIC_APP_ENV` at build time, so a container-level `environment:` entry
cannot fix a wrong badge after the fact.

---

## 6. Compose static validation

Staging (legacy pair) and production are separate models. Both must parse.

| Check                | Command                                                                                                           | Pass criteria |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- |
| Staging compose      | `docker compose --profile app --env-file docker/staging.env.example -f docker/compose.staging.yml config --quiet` | exit `0`      |
| Production compose   | `docker compose --env-file docker/production.env.example -f docker/compose.production.yml config --quiet`         | exit `0`      |
| Production YAML file | `python -c "import yaml; yaml.safe_load(open('docker/compose.production.yml'))"`                                  | exit `0`      |

Notes:

- `compose.production.yml` interpolates `${ROAMLOG_IMAGE_TAG:?...}`. For a
  static check against the template, export a CI-only value first:
  `export ROAMLOG_IMAGE_TAG=ci-validate`. **Never** remove the `:?` guard to make
  the command pass; the guard is what fails the deploy before a bad pull.
- `docker compose config` does not verify that
  `/opt/roamlog/config/.env.production` exists — that is what the preflight in
  step 1 is for.
- CI runs the same production command in the `quality` job
  (`.github/workflows/ci.yml`, "Production compose config validation"), so a
  green PR already proves the YAML model.

---

## 7. Release image tag and digests

| Check                    | Command / action                                                                                         | Pass criteria                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tag is a release tag     | `export ROAMLOG_IMAGE_TAG=<tag>` (e.g. `v0.1.0-rc.4`)                                                    | tag matches the release gate output; never `latest`, never `staging` |
| Five images published    | `docker manifest inspect ghcr.io/self-command/roamlog/{migrate,api,worker,web,admin}:$ROAMLOG_IMAGE_TAG` | all five resolve                                                     |
| Digests recorded         | write the five digests to `/opt/roamlog/config/image-digests.txt`                                        | five entries, one per component, same release tag                    |
| Deploy uses no `--build` | inspect the `up` command                                                                                 | `up -d --no-build`; no local build path in a release deploy          |

The release workflow publishes with provenance/SBOM enabled. If a digest is not
reproducible from the workflow log, stop: the image was not built by the gate.

---

## 8. DNS and TLS (including the media subdomain)

| Check                   | Command                                                                                                                             | Pass criteria                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| App host resolves       | `dig +short A <app-host>`                                                                                                           | returns the release host address                                        |
| Media host resolves     | `dig +short A <media-host>`                                                                                                         | returns the same release host (or the reviewed CDN edge)                |
| Certificate covers both | `openssl s_client -connect <media-host>:443 -servername <media-host> </dev/null 2>/dev/null \| openssl x509 -noout -subject -dates` | valid chain, not expiring within 14 days, `<media-host>` in subject/SAN |
| Media host serves TLS   | `curl -sSI https://<media-host>/minio/health/live`                                                                                  | HTTP `200`; no redirect to the app host                                 |
| Host header preserved   | review `deploy/nginx/media.conf.example` against the installed site                                                                 | `proxy_set_header Host $host;` present for the media upstream           |
| App host is TLS-only    | `curl -sSI http://<app-host>/`                                                                                                      | `301`/`308` to `https://`                                               |

`S3_PUBLIC_ENDPOINT` must be byte-identical to the host in the browser URL
(same scheme, same host, no trailing slash, no default-port suffix). A mismatch
is the most common `403 SignatureDoesNotMatch` after a media-host change — see
[media-delivery.md](./media-delivery.md).

DNS/TLS changes are made **before** the deploy and verified again after it. Do
not combine a DNS cutover with a code release unless the rollback plan covers
both.

---

## 9. Mail DNS

| Check                  | Command                                                                                         | Pass criteria                             |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| SPF/DKIM/DMARC/MX      | `node tooling/scripts/check-email-dns.mjs --domain <mail-domain> --dkim-selector resend`        | exit `0`; every record present and usable |
| Machine-readable proof | `node tooling/scripts/check-email-dns.mjs --domain <mail-domain> --dkim-selector resend --json` | JSON report attached to the ticket        |

Exit codes: `0` pass, `1` missing/invalid record, `2` resolver unreachable,
`64` bad usage. A code `2` is **not** a pass — fix the resolver or use
`--nameserver <ip>` and rerun.

Only verify a domain that is already delegated and verified with the provider.
Before switching `EMAIL_PROVIDER`, confirm the sender domain is verified in the
provider dashboard; the API refuses to boot otherwise. See
[email-production.md](./email-production.md).

---

## 10. Backup

| Check                      | Command                                                                                   | Pass criteria                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Fresh backup before deploy | `BACKUP_RETENTION_DAYS=14 /opt/roamlog/bin/backup-roamlog.sh`                             | exit `0`; new `0700` run directory with Postgres dump, MinIO mirror, `0600` env copy   |
| Backup readable            | `ls -l /opt/roamlog/backups/<run>/`                                                       | dump file non-zero; no `partial`/`tmp` suffix                                          |
| Restore drill current      | latest drill evidence from [production-backup-restore.md](./production-backup-restore.md) | drill completed within the last 30 days, restore verified against an isolated instance |

Never deploy on top of the only backup. If the run directory is incomplete, stop
and fix the backup job first.

---

## 11. Rollback readiness

| Check                   | Action                                                                    | Pass criteria                                                       |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Previous tag known      | record `PREV_TAG` in the ticket                                           | previous release tag + its five digests are still pullable          |
| Env file backed up      | `cp -p /opt/roamlog/config/.env.production /opt/roamlog/backups/env-<ts>` | `0600` copy exists and differs only by the intended release changes |
| Migration compatibility | read the release's migrations against [rollback.md](./rollback.md)        | every migration has a stated forward-fix or restore path            |
| Commands rehearsed      | dry-read the exact `ROAMLOG_IMAGE_TAG=$PREV_TAG ... up -d --no-build`     | command is copy-paste ready, no placeholder left                    |

Rollback that needs a schema restore is an incident, not a rollback. If the
release contains a destructive migration, get explicit approval before deploy.

---

## 12. Deploy and post-deploy smoke

Deploy (production compose only; no `--profile`, no `--build`):

```bash
cd /opt/roamlog/repo
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml pull
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml up -d --no-build
```

The object-storage bucket must exist before the first upload. `minio-init` is an
**opt-in profile** because the bootstrap script is a shell script and the pinned
`mc` images are distroless (no `/bin/sh`), so it must never gate API or worker
startup. Run it deliberately, once, with an `mc` image that ships a shell:

```bash
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml --profile init run --rm minio-init
```

Media CORS is answered by MinIO itself through `MINIO_API_CORS_ALLOW_ORIGIN`
(populated from `MEDIA_CORS_ORIGINS`); MinIO does not implement the S3 bucket
CORS API, so there is nothing to configure inside the bucket.

Watch `migrate` exit `0` before API/worker become healthy:

```bash
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml logs --no-color --tail=50 migrate
```

Smoke checks (placeholder hosts; use a real account from the approved secret
store, never a shared password in the ticket):

| #   | Surface           | Check                                                                   | Pass criteria                                                                                               |
| --- | ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Health            | `curl -fsS https://<app-host>/v1/health` and `/v1/ready`                | `200`, ready reports all dependencies ready                                                                 |
| 2   | Web login         | sign in at `https://<app-host>/login`                                   | session established; no redirect loop; `/v1/*` requests authorized                                          |
| 3   | Trip — all fields | create/edit a trip with title, dates, places, cover, visibility, budget | every field persists after reload; version conflict path behaves                                            |
| 4   | Media upload      | upload a cover image                                                    | browser PUT goes to `https://<media-host>/...` and returns `200`; image renders; no CORS or signature error |
| 5   | Place search      | search a city in the trip editor                                        | results return, selection persists                                                                          |
| 6   | Admin login       | sign in at `https://<app-host>/admin/login` (TOTP)                      | 2FA challenge enforced (`ADMIN_2FA_ENFORCED=true`)                                                          |
| 7   | Admin badge       | read the topbar environment badge                                       | `PRODUCTION` — if it says `STAGING`/`DEVELOPMENT`, the image was built with the wrong `NEXT_PUBLIC_APP_ENV` |
| 8   | Admin operations  | open the moderation/audit surface and perform one read + one write      | list loads with real data; the write appears in the audit trail                                             |
| 9   | Email             | trigger one verification or reset message                               | provider dashboard shows delivery; no `mailpit` transport in logs                                           |
| 10  | Edge protections  | `curl -sS -o /dev/null -w '%{http_code}' https://<app-host>/v1/metrics` | `404` (blocked by Nginx)                                                                                    |

Detailed per-route evidence requirements are in
[production-smoke-checklist.md](./production-smoke-checklist.md). Attach
screenshots for items 3–5 and the provider delivery record for item 9.

---

## 13. Sign-off

| Role             | Name | Date | Evidence (link / file) |
| ---------------- | ---- | ---- | ---------------------- |
| Release owner    |      |      |                        |
| API owner        |      |      |                        |
| Media/edge owner |      |      |                        |
| Ops / on-call    |      |      |                        |

Release is approved only when every step above is `PASS` and no item is marked
"follow-up". Any waived item needs the risk owner's name and a linked issue.
