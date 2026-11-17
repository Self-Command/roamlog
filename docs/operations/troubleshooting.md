# Troubleshooting

Start with:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app ps
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app logs --tail=200 postgres redis minio migrate api worker
curl -fsS https://api.staging.roamlog.app/v1/ready
```

Never paste cookies, passwords, reset tokens, invite tokens, or full connection
strings into an incident channel.

## Compose or image pull fails

- `pnpm staging:validate` must pass first.
- Check Docker Compose interpolation with `config`.
- MinIO community images are no longer anonymous public images. Authenticate to
  the approved Quay source or use the private mirrored digest.
- Do not replace a failed image pull with an unverified third-party tag.
- If a named volume cannot mount, stop and inspect the host path; do not delete
  data to make the container start.

## Migration job exits non-zero

- Read the migration job logs and `prisma migrate status`.
- Confirm `DATABASE_URL` points to staging, not local or production.
- Confirm Postgres is healthy and has no conflicting migration process.
- Preserve the database volume and take a dump before any repair.
- If a migration is partially applied, follow
  [migrations.md](./migrations.md) and [rollback.md](./rollback.md).

## `/v1/ready` returns 503

Look at the `checks` object:

- database down: check Postgres health, credentials, URL encoding, pool limits;
- Redis down: check password interpolation, AOF state, DNS/network;
- storage down: check MinIO/S3 health, access key, bucket policy, path style.

Avoid restarting Postgres or Redis blindly. Preserve logs and current state.

## Admin login fails

- Unauthenticated `/v1/admin/*` must return 401.
- A platform role without verified TOTP must return 403
  `ADMIN_2FA_REQUIRED`.
- Verify `ADMIN_2FA_ENFORCED=true`.
- Verify `SESSION_COOKIE_DOMAIN` fits the staging parent domain.
- Verify web/admin/API origins are HTTPS and listed exactly in CORS/trusted
  origins.
- Check the system clock; TOTP and cookie expiry are time-sensitive.
- Do not disable 2FA to unblock an operator. Use the enrolment route and a
  controlled password reset.

## Bootstrap errors

| Symptom                                    | Meaning                                             | Action                                                     |
| ------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| `Email delivery is not configured`         | No SMTP host and no real Resend key                 | Configure Mailpit/SMTP or a verified Resend key            |
| `verified TOTP factor`                     | Account has email verification but no verified TOTP | Sign in, open `/admin/2fa/enroll`, then rerun              |
| `active and have a verified email address` | Account suspended/unverified/deleted                | Resolve identity state; do not force promotion             |
| `temporarily locked`                       | TOTP lockout active                                 | Wait for the lock window or use the approved reset process |
| `database already has users`               | Existing DB without `--force`                       | Verify target and rerun with `--force`                     |
| `account_created_delivery_incomplete`      | Account created, email evidence incomplete          | Inspect EmailLog and provider, then recover the invitation |

The initial generated credential is never printed. If both invitation emails
are lost, use the normal forgot-password flow and resend verification. Do not
manually mark email verified without evidence.

## Email delivery

Inspect `EmailLog` for template, status, provider ID, and error category, then
check:

- Mailpit UI through the SSH tunnel for staging SMTP;
- SMTP host/port, auth, TLS requirements, and network egress;
- Resend API key, verified sending domain, bounce/complaint status;
- `EMAIL_FROM` domain alignment and DKIM/DMARC;
- rate limits and suppression lists.

The API redacts provider error details from public responses. Use server logs
and the email provider dashboard.

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT template, status, \"createdAt\" FROM \"EmailLog\" ORDER BY \"createdAt\" DESC LIMIT 20;"'
```

## Queue problems

Check Redis authenticity and prefix isolation first:

```bash
docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  exec redis sh -lc 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping'
```

Then inspect:

- queue names and `REDIS_PREFIX`;
- workers running with the same Redis URL and prefix;
- stalled jobs, retries, and failed counts;
- idempotency keys before manual re-enqueue;
- worker logs for serialization or missing dependency errors.

Only `super_admin` can perform queue lifecycle operations in the Admin API.
Every retry/pause/cleanup must be audited. Never flush all queues to clear one
stuck job.

## Media problems

- Confirm the bucket exists and is private.
- Confirm the app identity is not the MinIO root identity.
- Check bucket policy allows only the required bucket actions.
- Check `S3_FORCE_PATH_STYLE=true` for MinIO.
- Check `S3_ENDPOINT` from inside the API/worker network, not the host.
- Check signed URL expiry, CDN signing, and custom media domain.
- Check worker logs for image decode/thumbnail/Sharp failures.
- Quarantine failed uploads; do not serve unprocessed originals.

## Web/Admin 502 or blank page

- Confirm API readiness before restarting frontends.
- Check the Next.js process and `.next/cache` writable tmpfs.
- Check reverse-proxy upstream ports (13000, 13001, 14000 by default).
- Verify CSP did not block required scripts, map tiles, fonts, or media.
- Check for horizontal overflow and console errors after deployment; this is a
  regression, not an infrastructure workaround.

## Security incident

If a token, cookie, S3 key, or admin credential may be exposed:

1. Revoke the credential.
2. Rotate per [secret-rotation.md](./secret-rotation.md).
3. Invalidate sessions and inspect audit logs.
4. Preserve logs and scope affected tenants.
5. Notify the incident owner; do not hide the failure by deleting logs.
