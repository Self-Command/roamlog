# Roamlog API

Wave 0 platform skeleton for the Roamlog full-stack application. This package owns the HTTP
runtime, health/readiness checks, observability, and shared infrastructure adapters. It does not
yet implement authentication, tenants, trips, journals, media business flows, or realtime
features.

## Local commands

```bash
pnpm --filter @roamlog/api dev
pnpm --filter @roamlog/api test:e2e -- health problem-details storage
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/api build
```

The API listens on `http://localhost:4000` by default and reads the workspace `.env.local` when
started outside tests.

## Endpoints

- `GET /v1/health` — dependency-free liveness.
- `GET /v1/ready` — database, Redis, and S3/MinIO readiness; returns `503` with sanitized checks
  when a dependency is unavailable.
- `GET /v1/metrics` — Prometheus text metrics, including process defaults and HTTP latency/count
  metrics.

All errors use RFC 7807 `application/problem+json`. Responses include `x-request-id`; incoming
safe request IDs are preserved.

## Admin bootstrap

```bash
pnpm --filter @roamlog/api admin:bootstrap -- --force
```

The CLI intentionally promotes an **existing** active account only after it has a verified email
and a complete TOTP second factor. It never creates or prints a password. First-account creation
and password/2FA enrollment email delivery belong to the Better Auth task. In production,
`--force` is mandatory.

## Test strategy

Vitest runs real Nest HTTP tests through Supertest. External dependencies are replaced only at
the platform adapter boundary for readiness tests; storage tests exercise real AWS SDK request
signing and mock only the S3 transport.
