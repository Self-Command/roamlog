# Secret rotation

## Inventory

| Secret                                            | Owner               | Rotation impact                                       | Stored in                               |
| ------------------------------------------------- | ------------------- | ----------------------------------------------------- | --------------------------------------- |
| `BETTER_AUTH_SECRET`                              | Auth owner          | Invalidates sessions/cookies and pending signed state | Staging secret manager / `.env.staging` |
| `POSTGRES_PASSWORD`                               | Database owner      | API/worker/DB outage during change                    | DB provider / secret manager            |
| `REDIS_PASSWORD`                                  | Platform owner      | Queue/realtime outage during change                   | Redis provider / secret manager         |
| `MINIO_ROOT_PASSWORD`                             | Platform owner      | Bootstrap only; no normal traffic if app uses S3 user | MinIO secret                            |
| `S3_SECRET_KEY`                                   | Platform owner      | Upload/export/media failures                          | S3 provider / secret manager            |
| `RESEND_API_KEY`                                  | Email owner         | Verification/reset/invite delivery failures           | Resend/secret manager                   |
| `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET`    | Auth owner          | OAuth login failures                                  | Provider/secret manager                 |
| `SENTRY_DSN`                                      | Observability owner | Error reporting loss                                  | Sentry/secret manager                   |
| `CONFIG_ENCRYPTION_KEY`, `CONFIG_ENCRYPTION_KEYS` | Settings owner      | Wrong handling makes stored Admin secrets unreadable  | Secret manager + off-host backup        |

`BOOTSTRAP_SUPER_ADMIN_EMAIL` is an operational target, not a secret. It is
still personal data and must not be committed in a real deployment file.

## Rules

- Rotate on a schedule, after suspected exposure, and when a human with access
  leaves the team.
- Generate with a CSPRNG (for example `openssl rand -base64 48` or
  `openssl rand -hex 32`).
- Update the secret manager first, then restart one service at a time, then
  revoke the old credential.
- Record who rotated, when, why, affected services, and verification evidence.
- Never paste secret values into audit logs, Sentry, or incident chat.

## Better Auth secret

1. Announce a short auth maintenance window.
2. Generate a new secret of at least 32 bytes.
3. Update `BETTER_AUTH_SECRET` in the staging secret store.
4. Restart API and expire active sessions if the application does not do so
   automatically.
5. Verify sign-in, verification, password reset, TOTP challenge, and admin gate.
6. Expect all existing sessions to be invalidated.

Do not run API replicas with old and new auth secrets for an extended period;
signed cookies and provider state may fail unpredictably.

## PostgreSQL

Use a maintenance window:

1. Create a new database role or rotate the password with the provider.
2. Update `DATABASE_URL`/`POSTGRES_PASSWORD` in the secret manager.
3. Restart migration and application services.
4. Verify `/v1/ready`, a read, a write, and a worker database job.
5. Remove old credentials after the validation window.

Never put the password in a URL without percent-encoding; prefer a generated
hex value.

## Redis

1. Set the new password on the provider or via `ACL SETUSER`/`CONFIG SET`.
2. Update `REDIS_URL`/`REDIS_PASSWORD`.
3. Restart API and worker; verify WebSocket/realtime and queue enqueue/consume.
4. Revoke the old password.

If the provider cannot overlap old and new credentials, expect a short outage.
Do not flush the queue as part of rotation.

## S3/MinIO

1. Create a new application access key with the same bucket-only policy.
2. Update `S3_ACCESS_KEY`/`S3_SECRET_KEY`.
3. Restart API and worker.
4. Verify upload, signed URL, thumbnail, export, and delete.
5. Revoke the old access key. Do not rotate the MinIO root user for routine
   application access; the root identity is bootstrap-only.

## Resend and OAuth

- Create the new Resend key, update the API secret, send a test to a controlled
  inbox, then revoke the old key.
- Rotate OAuth client secrets in Google/GitHub, update callback URLs, restart
  API, and execute a full callback login before revoking the old value.
- Confirm SPF/DKIM/DMARC for the sending domain before changing `EMAIL_FROM`.

## Settings encryption key

`CONFIG_ENCRYPTION_KEY` is not like the other secrets in this inventory: it
protects the encrypted Admin settings (SMTP password, S3 credentials, Resend
key, places key). Replacing it without a key ring makes **every stored secret
permanently undecryptable**, and no backup can recover it. Never regenerate it
"because the API still boots" — the API only needs it when a secret is written
or read.

Do not rotate it as part of a release. The full key-ring procedure, SQL
verification and loss handling are in
[settings-encryption.md](./settings-encryption.md).

## Post-rotation checks

```bash
curl -fsS https://api.staging.roamlog.app/v1/ready
```

Then verify:

- email/password login and email verification;
- Google and GitHub login if enabled;
- TOTP challenge;
- admin 2FA gate and super-admin access;
- one media upload and signed URL;
- one queue job;
- audit log entry for the operational change.
