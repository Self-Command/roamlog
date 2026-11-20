# AVATAR_EMAIL_FIX acceptance

Real-browser acceptance for the two "wired but unusable" defects:

1. **Avatar** — was stored as a 900-second S3 signed URL, so it disappeared 15
   minutes after upload. Now the row stores the media id and the API re-signs on
   every read.
2. **Change email** — `POST /v1/auth/change-email` answered
   `400 CHANGE_EMAIL_DISABLED` because Better Auth's `user.changeEmail.enabled`
   defaults to `false`.

Nothing is mocked. The account under test is created through
`POST /v1/auth/sign-up/email` and verified by clicking the link the app itself
mailed, the avatar goes through the real media pipeline
(`presign → PUT → complete → worker → poll`), and the change-email confirmation
links are read out of Mailpit (a local SMTP sink, not a real inbox) and clicked.

## Stack used

There are two supported modes. The isolated mode runs a second API/web from the
same working tree on separate ports and never touches `4000`. The live mode
uses the long-running `3000/4000` stack after an API restart.

| What | Where | Notes |
| --- | --- | --- |
| API (current code) | `http://127.0.0.1:4173` | `apps/api/src/main.ts`, dev DB |
| Web (current code) | `http://127.0.0.1:3200` | `next dev` on `.e2e-live/runtime/web`, `API_URL=4173` |
| Postgres | `127.0.0.1:55444` DB `roamlog_local` | the dev database the running API uses |
| Redis | `127.0.0.1:6379` | `tooling/services/runtime/bin/redis/.../redis-server.exe` |
| BullMQ worker | `apps/worker` | required for media processing |
| Mailpit | `127.0.0.1:1025` / `:8025` | local SMTP capture |
| S3 | `127.0.0.1:9000` | `.audit/tools/s3-stub.mjs` (another agent's local stub; it does **not** verify SigV4) |

Start the prerequisites:

```bash
# redis
./tooling/services/runtime/bin/redis/Redis-8.10.3-Windows-x64-msys2/redis-server.exe \
  --port 6379 --bind 127.0.0.1 --save '' --appendonly no
# mailpit
./tooling/services/runtime/bin/mailpit/mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
# worker
cd apps/worker && DATABASE_URL='postgresql://roamlog:roamlog@127.0.0.1:55444/roamlog_local?schema=public' \
  REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx src/main.ts
```

The API (`4173`) and web (`3200`) are declared as `webServer` entries in
`playwright.avatar-email.config.ts` with `reuseExistingServer: true`, so running
the suite starts them if they are not already up.

## Run

### Isolated (`4173` / `3200`)

```bash
node node_modules/@playwright/test/cli.js test e2e/avatar-email \
  --config=playwright.avatar-email.config.ts
```

### Live (`3000` / `4000`)

This does not start or replace either server. It requires the real local stack
to already be up, using `localhost` for both URLs so the session cookie is shared:

```bash
ROAMLOG_ACCEPTANCE_API_URL=http://localhost:4000 \
ROAMLOG_ACCEPTANCE_WEB_URL=http://localhost:3000 \
ROAMLOG_ACCEPTANCE_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public' \
ROAMLOG_ACCEPTANCE_MAILPIT_URL=http://127.0.0.1:8025 \
node node_modules/@playwright/test/cli.js test e2e/avatar-email \
  --config=e2e/avatar-email/playwright.live.config.ts
```

The `4000` API starts an in-process Redis cache stub on `46379`. BullMQ cannot
consume jobs through that stub, so the local media path must use the existing
`.audit/tools/worker-drain.sh --watch` process (it runs the real
`handleMediaJob` handler and DB/S3 pipeline, but not Redis queue delivery).

## Files

- `avatar-stability.spec.ts` — upload through the settings page, assert the
  stored value is a media id (DB), assert `GET /v1/me` re-signs a fresh loadable
  URL on every read and after a reload; 1440 + 390 screenshots.
- `change-email.spec.ts` — submit the settings form, assert `200` (not
  `CHANGE_EMAIL_DISABLED`), the `EmailLog` row, the confirmation mail to the
  current address, then click both links and assert the address moved.
- `settings-fail-safe.spec.ts` — save display name/timezone/language and reload,
  then cover empty input, wrong avatar type, 401, 403, 503 and an aborted
  network request; 1440 + 390 profile screenshots.
- `playwright.live.config.ts` — no `webServer`; runs against the already-running
  `3000` Web and `4000` API.
- `ttl-after-expiry.mjs` — proof that the avatar survives its signed URL
  expiring, run against an API started with `MEDIA_SIGNED_URL_TTL_SECONDS=60`:

  ```bash
  ROAMLOG_ACCEPTANCE_API_URL=http://127.0.0.1:4373 \
    node e2e/avatar-email/ttl-after-expiry.mjs <email> <password>
  ```
- `support.ts` — sign-up + verify helper, Mailpit reader, read-only DB queries.
