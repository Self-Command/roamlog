# Health and monitoring

## Endpoints

| Endpoint            | Purpose                               | Public access                  |
| ------------------- | ------------------------------------- | ------------------------------ |
| `GET /v1/health`    | Dependency-free process liveness      | Ingress health probes only     |
| `GET /v1/ready`     | PostgreSQL, Redis, S3/MinIO readiness | Ingress health probes only     |
| `GET /v1/metrics`   | Prometheus metrics                    | Never public; block at ingress |
| Socket.IO namespace | Presence and cache invalidation       | Requires authenticated session |

The API health response is `{"status":"ok"}`. Readiness returns HTTP 503 with
sanitised dependency states when a dependency is unavailable. Do not expose
database URLs or provider errors in a public health response.

## Compose checks

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app ps
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app logs --tail=200 api worker
curl -fsS https://api.staging.roamlog.app/v1/ready
```

Container health sources:

- Postgres `pg_isready`;
- Redis authenticated `PING`;
- MinIO live endpoint;
- Mailpit live endpoint;
- API `/v1/health`;
- web/admin `/login`;
- worker process liveness.

The worker image has no queue-specific HTTP probe. A process healthcheck only
detects a dead runtime. Queue lag, failed jobs, and stalled workers require the
Redis/BullMQ and Admin queue views described below.

## Signal map

API metrics include process defaults plus HTTP request count, latency, and error
dimensions. Sentry captures API/web/admin exceptions. Pino JSON logs include
request IDs, user IDs, workspace IDs, and redacted sensitive fields.

Monitor:

- API 5xx rate and p95 latency;
- `/v1/ready` failures by dependency;
- DB connections and slow queries;
- Redis reachability and memory;
- queue wait/lag, failed jobs, retries, and stalled jobs;
- email send failure/bounce/complaint rate;
- media processing time and failures;
- S3 bucket errors and signed URL failures;
- TLS certificate expiry, Caddy/Nginx 5xx, and host disk;
- auth failures, rate-limit spikes, and 2FA lockouts.

## Baseline SLOs

- API availability for `/v1/ready`: 99.5% staging target.
- API p95: below 300 ms for the normal trip list/search profile.
- API 5xx rate: below 1% over a rolling 15 minutes.
- Queue lag: below 60 seconds for normal staging traffic.
- Media processing p95: below 15 seconds for test images.

These are staging gates, not production commitments.

## Alert routing

Use the staging on-call channel for:

- readiness down for more than two minutes;
- sustained API 5xx above 5%;
- queue lag above five minutes or worker heartbeat missing;
- email delivery failures above threshold;
- storage unavailable or media processing blocked;
- certificate expiring within 14 days;
- unauthorised Admin API successes or missing 2FA enforcement.

Every alert must name the service, environment, runbook, and first diagnostic
command. Do not page on raw container restarts without user impact.

## Log and privacy rules

- Keep Pino/Sentry redaction enabled.
- Never log request bodies containing passwords, TOTP codes, reset tokens,
  invite tokens, cookies, or object-store credentials.
- Treat audit logs as operational evidence, not a debugging dump for PII.
- Restrict metrics and logs to the staging operator network.
