# Operations runbooks

| Runbook                                                          | Use                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [release-checklist.md](./release-checklist.md)                   | rc.4 pre-release gate: env preflight, contracts, build, compose, smoke    |
| [staging-deployment.md](./staging-deployment.md)                 | Prepare secrets, start compose, TLS/CORS/CSP/HSTS, bootstrap, smoke tests |
| [release-gate.md](./release-gate.md)                             | CI dry run, GHCR publication, staging image deployment                    |
| [media-delivery.md](./media-delivery.md)                         | Two storage endpoints, presigning, bucket CORS, media DNS/TLS             |
| [email-production.md](./email-production.md)                     | Production mail provider, SPF/DKIM/DMARC checks, rollback                 |
| [migrations.md](./migrations.md)                                 | Migration preflight, apply, failure recovery                              |
| [backup-restore.md](./backup-restore.md)                         | PostgreSQL, object storage, Redis recovery and drills                     |
| [production-backup-restore.md](./production-backup-restore.md)   | Production backup script, verification, isolated restore                  |
| [production-smoke-checklist.md](./production-smoke-checklist.md) | Post-deploy route, auth, media, edge, and rollback checks                 |
| [rollback.md](./rollback.md)                                     | Application rollback and schema compatibility                             |
| [secret-rotation.md](./secret-rotation.md)                       | Rotate auth, DB, Redis, S3, email, OAuth secrets                          |
| [settings-encryption.md](./settings-encryption.md)               | Settings secret key, loss/rotation key ring, failure modes                |
| [places.md](./places.md)                                         | Geoapify/Photon providers, quota, cache, attribution and terms            |
| [ai-provider.md](./ai-provider.md)                               | AI protocols, provider recipes, timeout/quota, failure codes, cost        |
| [health-and-monitoring.md](./health-and-monitoring.md)           | Endpoints, health checks, signals, SLOs, alerting                         |
| [troubleshooting.md](./troubleshooting.md)                       | Compose, auth, email, queue, media, and ingress failures                  |

## Current deployment boundary

- The repository contains production-oriented Dockerfiles, the production
  stack `docker/compose.production.yml`, and a legacy staging compose stack
  using PostgreSQL, Redis, MinIO, Mailpit, API, worker, web, and admin.
- GitHub Actions defines a full quality gate and a dry-run-capable release
  workflow that publishes immutable images to GHCR. The quality gate validates
  both the staging and the production compose files statically.
- The single-host `we.spacedo.org` deployment is
  `docker/compose.production.yml` plus
  `/opt/roamlog/config/.env.production`, behind host Nginx. The
  `docker/compose.staging.yml` + `docker/compose.server.yml` pair is legacy
  staging only and is never layered under production. Admin is same-origin
  under `/admin/*` and `/admin-assets/*`; the API is same-origin under `/v1/*`
  and `/v1/ws`.
- The supported ingress path is Cloudflare (when enabled) to one host Nginx
  instance to loopback app ports. Only Nginx is trusted by the application.
- Automatic staging host rollout, DNS, certificates, external monitoring, k6
  gates, and managed backup credentials are not encoded in this repository.
  Backup execution and restore drills remain operator steps; see
  [production-backup-restore.md](./production-backup-restore.md).
- MinIO's upstream community images require authenticated/mirrored access.
  Staging cannot be started from a clean host without resolving that image
  source.
- The local machine used for this change had no Docker CLI. Compose files,
  workflows, environment templates, and shell syntax were statically validated;
  containers were not started here.
