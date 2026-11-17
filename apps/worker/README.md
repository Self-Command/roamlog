# Roamlog Worker

Wave 0 provides the background-job runtime only. The five queue processors are
intentionally placeholders: they fail with `PROCESSOR_NOT_CONFIGURED` until the
Wave 2 handlers replace them. No media processing, export generation, reminder
delivery, or email business flow is implemented here yet.

## Queues

| Queue         | Concurrency | Retries | Backoff          |
| ------------- | ----------: | ------: | ---------------- |
| `media`       |           2 |       3 | exponential, 5s  |
| `email`       |          10 |       5 | exponential, 2s  |
| `export`      |           2 |       2 | exponential, 10s |
| `reminders`   |           5 |       3 | exponential, 5s  |
| `maintenance` |           1 |       1 | exponential, 30s |

Every producer must use `enqueueJob()` and provide an explicit `jobId`. BullMQ
uses that ID as the idempotency key, so adding the same ID again while the job is
retained does not create a second job. IDs must be non-empty, must not be an
integer, and must not contain `:`.

Processors implement:

```ts
interface JobProcessor {
  name: string;
  handle(job: Job): Promise<unknown>;
}
```

The runtime writes structured pino JSON events for `active`, `completed`,
`failed`, `stalled`, and connection errors. Each job event includes `queue`,
`jobId`, `jobName`, and processor metadata. A thrown handler error is handled by
BullMQ, marks the job as failed, and does not terminate the worker.

## Local commands

```bash
docker compose -f docker/compose.yml up -d redis minio mailpit
pnpm --filter @roamlog/worker dev
pnpm --filter @roamlog/worker test
pnpm --filter @roamlog/worker build
pnpm tooling:minio-smoke
pnpm --filter @roamlog/emails email:smoke
```

The worker loads the root `.env.local` automatically when one is present. Set
`ROAMLOG_ENV_FILE` to override that path.

## Mailpit

Mailpit captures local SMTP and exposes its UI at
`http://localhost:8025`. For a direct accessibility check:

```bash
curl -fsS http://localhost:8025/livez
```

The email smoke command uses Mailpit's HTTP send API (`POST /api/v1/send`) to
render and deliver one sample of every Wave 0 template. It does not use Resend
and does not prove production deliverability. Open the printed
`http://localhost:8025` URL to inspect the captured messages.

## MinIO

The storage smoke uses the private local bucket configured by
`S3_BUCKET`, uploads a randomized object under `_smoke/`, reads it back with
credentials, and deletes it. It never requests a public ACL and never prints
access keys or secrets. See `tooling/scripts/minio-smoke.ts`.
