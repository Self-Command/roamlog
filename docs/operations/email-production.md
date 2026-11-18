# Production email delivery

This runbook moves Roamlog outbound mail from the local Mailpit catcher to a
real provider (Resend or an SMTP relay), and verifies the sending domain.

Mailpit remains supported for local development and for the legacy staging
stack. It is rejected at boot when `APP_ENV=production`.

## 1. Ownership: which process sends which mail

| Mail                                               | Producer                                | Transport                                |
| -------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| Verification, password reset, workspace invitation | `@roamlog/api` (`EmailDeliveryService`) | Resend HTTP **or** SMTP via `nodemailer` |
| Queued notifications, mentions, digests            | `@roamlog/worker` (`createEmailSender`) | Resend HTTP **or** Mailpit HTTP          |

Two constraints follow from the code:

1. **The worker has no SMTP client.** `nodemailer` is an `@roamlog/api`
   dependency and is not resolvable from `@roamlog/worker` under pnpm. Worker
   mail therefore requires `EMAIL_PROVIDER=resend`. Setting `smtp` makes the
   worker fail with an explicit `NonRetryableEmailError` naming this limit.
   Adding a worker SMTP client is a dependency decision (ADR), not a config
   change.
2. **The API prefers SMTP whenever `SMTP_HOST` is set.** To keep one provider
   authoritative, `EMAIL_PROVIDER=resend` requires `SMTP_HOST` to be empty. The
   API validates this at boot.

## 2. Configuration

`APP_ENV=production` activates every rule below. `NODE_ENV` is deliberately not
the gate: staging also runs `NODE_ENV=production`.

| Variable         | Required when | Rule                                                                                               |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `APP_ENV`        | always        | `production` turns strict mail validation on                                                       |
| `EMAIL_PROVIDER` | always        | `resend` \| `smtp` \| `mailpit`; default `smtp`                                                    |
| `EMAIL_FROM`     | always        | `Name <local@domain>`; a `.local` domain is rejected in production                                 |
| `RESEND_API_KEY` | `resend`      | must start with `re_` and must not be a placeholder                                                |
| `SMTP_HOST`      | `smtp`        | must be a real relay; `mailpit`, `localhost`, `127.0.0.1`, `*.local`, `*.example.com` are rejected |
| `SMTP_PORT`      | `smtp`        | `1025` (local catcher) is rejected                                                                 |
| `SMTP_USER`      | `smtp`        | non-empty                                                                                          |
| `SMTP_PASSWORD`  | `smtp`        | non-empty, not a placeholder                                                                       |
| `SMTP_HOST`      | `resend`      | must be empty (see §1)                                                                             |

Validation failures abort API startup with a message naming the variable and
the rule. Secret values are never echoed into the error.

Template: [`docker/production.env.example`](../../docker/production.env.example).
Copy it to `/opt/roamlog/config/.env.production` with mode `0600`; fill
`[deployer]` values by hand and inject every `[secret]` value from the approved
secret store. Never commit a populated file.

## 3. Resend setup

1. Verify the sending domain in the Resend dashboard. Use a subdomain such as
   `mail.<domain>` if the apex is managed by another mail system.
2. Publish the records Resend shows. Typical shape, with `example.com` standing
   in for your domain and `resend` for the DKIM selector:

   | Purpose     | Type | Name                            | Value                                                  |
   | ----------- | ---- | ------------------------------- | ------------------------------------------------------ |
   | SPF         | TXT  | `example.com`                   | `v=spf1 include:<resend-spf-host> ~all`                |
   | DKIM        | TXT  | `resend._domainkey.example.com` | `p=<public-key>` (long value)                          |
   | Return path | MX   | `send.example.com`              | `<priority> <resend-return-path-host>`                 |
   | DMARC       | TXT  | `_dmarc.example.com`            | `v=DMARC1; p=quarantine; rua=mailto:<reports-mailbox>` |

   Publish exactly one `v=spf1` record per name. A second SPF record is a
   permanent SPF error, not a merge.

3. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=<re_...>`, and
   `EMAIL_FROM=Roamlog <no-reply@example.com>` in the production env file.
4. Keep `SMTP_HOST` empty.
5. Restart the API and confirm it boots (validation runs at startup).

## 4. SMTP relay alternative

Use this only if the provider has no usable HTTP API and you accept that
worker-originated mail is unavailable (`EMAIL_PROVIDER=smtp` fails in the
worker).

1. Obtain relay host, port, username, and password from the provider.
2. Set `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT` (typically `587`),
   `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM`.
3. Leave `RESEND_API_KEY` empty.
4. Confirm the API container can reach the relay: the worker/web networks are
   isolated, the API uses the `backend` + `edge` networks, and outbound access
   must be allowed on the relay port.

## 5. DNS verification

Run the read-only preflight. It performs DNS lookups only: it never sends mail
and never calls the provider API.

```bash
node tooling/scripts/check-email-dns.mjs --domain example.com
node tooling/scripts/check-email-dns.mjs --domain example.com --dkim-selector resend
node tooling/scripts/check-email-dns.mjs --domain example.com --json
```

Output grades each record `PASS`/`FAIL` and lists what is missing:

```text
SPF    PASS example.com (TXT)
         v=spf1 include:<resend-spf-host> ~all
DKIM   PASS resend._domainkey.example.com (TXT)
         <first 24 chars of key>... (<length> chars)
DMARC  PASS _dmarc.example.com (TXT)
         v=DMARC1; p=quarantine; rua=mailto:<reports-mailbox>
MX     PASS send.example.com (MX)
         no apex MX; using return-path MX at send.example.com

overall: PASS
```

Exit codes: `0` all records usable, `1` missing/invalid record, `2` DNS lookup
failed (no network or unreachable resolver), `64` bad usage.

Notes:

- A null MX (`0 .`, RFC 7505) is graded `FAIL`: the domain accepts no mail.
- `p=none` in DMARC is graded `PASS` with a warning; tighten to
  `quarantine`/`reject` once reports look clean.
- `--nameserver <ip[:port]>` targets a specific resolver, which is useful on
  CI or behind a private resolver.

After DNS is green, send a real message through a product flow (invite a
throwaway workspace member or trigger a password reset) and confirm delivery,
`providerId` on the email log row, and the absence of bounces.

## 6. Verification checklist

```text
[ ] docker/production.env.example copied to /opt/roamlog/config/.env.production (0600)
[ ] APP_ENV=production and EMAIL_PROVIDER set explicitly
[ ] EMAIL_FROM on a verified domain, not .local
[ ] RESEND_API_KEY present (resend) or SMTP_* complete (smtp)
[ ] SMTP_HOST empty when EMAIL_PROVIDER=resend
[ ] node tooling/scripts/check-email-dns.mjs --domain <domain> exits 0
[ ] API boot succeeds (validation would abort otherwise)
[ ] one real message delivered end to end
[ ] email_log row has status sent and a providerId
[ ] provider dashboard shows no bounce/complaint spike
```

## 7. Rollback

Mail is not a data migration: rollback is a configuration change.

1. Keep the previous env file: copy `.env.production` to
   `.env.production.bak-<date>` before editing (mode `0600`).
2. To return to the previous provider, restore `EMAIL_PROVIDER`, `EMAIL_FROM`,
   and the matching credentials, then
   `docker compose --env-file /opt/roamlog/config/.env.production -f docker/compose.production.yml up -d api worker`.
3. Never "roll back" to `EMAIL_PROVIDER=mailpit` in production: the API refuses
   to start, by design. The catcher exists only in the legacy staging stack.
4. If the provider rejects the domain, the affected job retries with backoff
   (email queue: 5 attempts) and then lands in `failed` with the provider status
   recorded. Permanent errors (401/403/422) are raised as BullMQ
   `UnrecoverableError` and skip the remaining retries.
5. Broken DNS is not fixed by a restart. Re-publish the record, wait for the
   TTL, re-run §5, then replay failed jobs.

## 8. Known gaps

- Worker SMTP transport is unsupported (see §1). Production worker mail needs
  Resend or an approved dependency change.
- `S3_PUBLIC_BASE_URL` is reserved in the template but the API still signs media
  URLs with the internal MinIO endpoint; see the "Known integration gap" in
  [`deploy/README.md`](../../deploy/README.md).
- Bounce and complaint webhooks from the provider are not consumed yet; monitor
  them in the provider dashboard.
