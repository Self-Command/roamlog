# Operations runbooks

| Runbook                                                | Use                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| [staging-deployment.md](./staging-deployment.md)       | Prepare secrets, start compose, TLS/CORS/CSP/HSTS, bootstrap, smoke tests |
| [release-gate.md](./release-gate.md)                   | CI dry run, GHCR publication, staging image deployment                    |
| [migrations.md](./migrations.md)                       | Migration preflight, apply, failure recovery                              |
| [backup-restore.md](./backup-restore.md)               | PostgreSQL, object storage, Redis recovery and drills                     |
| [rollback.md](./rollback.md)                           | Application rollback and schema compatibility                             |
| [secret-rotation.md](./secret-rotation.md)             | Rotate auth, DB, Redis, S3, email, OAuth secrets                          |
| [health-and-monitoring.md](./health-and-monitoring.md) | Endpoints, health checks, signals, SLOs, alerting                         |
| [troubleshooting.md](./troubleshooting.md)             | Compose, auth, email, queue, media, and ingress failures                  |

## Current deployment boundary

- The repository contains production-oriented Dockerfiles and a staging
  compose stack using PostgreSQL, Redis, MinIO, Mailpit, API, worker, web, and
  admin.
- GitHub Actions defines a full quality gate and a dry-run-capable release
  workflow that publishes immutable images to GHCR.
- Automatic staging host rollout, DNS, certificates, external monitoring, k6
  gates, and managed backup credentials are not encoded in this repository.
- MinIO's upstream community images require authenticated/mirrored access.
  Staging cannot be started from a clean host without resolving that image
  source.
- The local machine used for this change had no Docker CLI. Compose files,
  workflows, environment templates, and shell syntax were statically validated;
  containers were not started here.
