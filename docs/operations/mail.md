# Transactional mail configuration

Status: the API now sends transactional mail with the `mail.*` settings the
Admin console owns (B2 "mail" group). The worker is **not** connected yet: its
export-notification email still reads the process environment. See §7.

Related files:

- `apps/api/src/modules/settings/mail-settings.consumer.ts` — layer precedence,
  completeness check and `secure` derivation
- `apps/api/src/modules/email/mail.service.ts` — nodemailer / Resend transport,
  error classification, 30s transport cache, log redaction
- `apps/api/src/modules/auth/email-delivery.service.ts` — templates + `EmailLog`
- `apps/api/src/modules/email/mail-test.controller.ts` — real test send
- `apps/api/src/modules/settings/settings.registry.ts` — the seven `mail.*` keys
  (read-only for this slice)

## 1. Settings and environment fallbacks

| Admin key            | Environment fallback | Default (code)                   |
| -------------------- | -------------------- | -------------------------------- |
| `mail.provider`      | `EMAIL_PROVIDER`     | `smtp`                           |
| `mail.from`          | `EMAIL_FROM`         | `Roamlog <hello@roamlog.local>`  |
| `mail.resendApiKey`  | `RESEND_API_KEY`     | unset (`null`)                   |
| `mail.smtpHost`      | `SMTP_HOST`          | `localhost` (placeholder)        |
| `mail.smtpPort`      | `SMTP_PORT`          | `587`                            |
| `mail.smtpUser`      | `SMTP_USER`          | empty                            |
| `mail.smtpPassword`  | `SMTP_PASSWORD`      | unset (`null`)                   |

Precedence per key:

1. an **environment-locked** key always uses the environment value;
2. otherwise a value stored through Admin settings wins over the environment;
3. otherwise the environment wins over the code default;
4. a database outage or an empty stored value falls back to the environment,
   then the default, with a `mail.settings_unavailable` /
   `mail.settings_empty_fallback` warning. Sends never throw because of a
   settings read.

`POST /v1/admin/settings` is the only supported way to change these values.
`mail.resendApiKey` and `mail.smtpPassword` are encrypted at rest with
`CONFIG_ENCRYPTION_KEY`; a deployment that wants to save them through the Admin
console must set that key (otherwise the write is rejected with
`SETTINGS_ENCRYPTION_UNAVAILABLE`).

## 2. Transport rules

- `smtp`: implicit TLS on port **465**, STARTTLS on every other port (587, 25,
  1025, …). Authentication is only sent when `mail.smtpUser` is set; anonymous
  relays work. A username without a password is treated as incomplete.
- `resend`: `POST https://api.resend.com/emails` with a **10 second** timeout.
- `configured: false` is returned when the transport identity is missing. The
  `localhost` code default does **not** count as a configured relay: an operator
  must set the host (DB or `SMTP_HOST`) or a Resend key. The response lists the
  missing keys.
- An SMTP transport is reused for at most **30 seconds**; the runtime is
  resolved again on every send. A settings save therefore reaches the next
  send immediately in this process, and at worst within the SettingsService 5s
  cache window on other instances (Redis pub/sub invalidates it).

## 3. What the API sends today

| Flow                                  | Transport path                             | When mail is not configured |
| ------------------------------------- | ------------------------------------------ | --------------------------- |
| Sign-up verification email            | better-auth callback → `EmailDeliveryService` | registration still succeeds; the JSON body carries `emailDelivery: "not_configured"` |
| `POST /v1/auth/send-verification-email` | same callback                              | **503** `{ code: "MAIL_NOT_CONFIGURED" }`, no token minted |
| Password reset request (`forget-password`) | better-auth callback                  | **200** `{ status: true, emailDelivery: "not_configured" }` (no fake send, no 500) |
| Workspace invitation                  | `InvitationsService` → `EmailDeliveryService` | **503** `INVITATION_DELIVERY_FAILED`, the pending invitation is revoked |
| Admin "send test"                     | `MailTestController` → `MailService`       | **422** `NOT_CONFIGURED`     |

Every attempt is recorded in `EmailLog`; a not-configured attempt is stored as
`status = failed`, `error = mail_not_configured`, and logged as
`mail.not_configured` with the missing key names only.

## 4. Test send endpoint

```
POST /v1/admin/settings/mail/test
Authorization: super_admin session (admin:settings:write)
{ "to": "you@example.com" }
```

- `200 {"ok":true,"provider":"smtp"|"resend","latencyMs":N}` — the transport
  actually accepted the message. This is not a dry run.
- `422 {"ok":false,"code":...,"message":...}` with `code` one of
  `NOT_CONFIGURED`, `AUTH_FAILED`, `CONNECTION_FAILED`, `REJECTED` (plus
  `INVALID_REQUEST` for a malformed body).
- Rate limit: **3 per minute per admin**, Redis-backed with a process-local
  fallback.
- Audit: `admin.mail.probe`, metadata `{ ok, provider }` only — no recipient,
  no credentials.

Failure → action:

| Code                | Meaning                                   | Fix |
| ------------------- | ----------------------------------------- | --- |
| `AUTH_FAILED`       | relay rejected the credentials (`EAUTH`)  | re-enter username / app-specific password; Gmail requires 2FA + an app password, and `SMTP_HOST=smtp.gmail.com`, port 587 (STARTTLS) or 465 |
| `CONNECTION_FAILED` | unreachable host/port or timeout          | check host, port and firewall; `127.0.0.1` only works for a local catcher |
| `REJECTED`          | envelope/sender rejected (`EENVELOPE`, 5xx, 4xx policy) | verify `mail.from` belongs to the relay / verified Resend domain |
| `NOT_CONFIGURED`    | missing host/from/API key                 | fill the mail group |

## 5. Logging and redaction

Logs contain `provider`, `toDomain`, `providerId`, `latencyMs` and SMTP/HTTP
status codes only. Passwords, API keys, full recipient addresses and raw
provider error bodies are never logged or returned.

## 6. Local verification

Local sink (see `.audit/local-verify/smtp-sink.mjs`) listens on
`127.0.0.1:1025` and writes `.eml` files plus `links.txt` under
`.data/local-verify/mail/`.

```bash
# with the API running against the local database
curl -X PATCH http://127.0.0.1:4000/v1/admin/settings \
  -H 'content-type: application/json' \
  -d '{"updates":[{"key":"mail.provider","value":"smtp"},{"key":"mail.smtpHost","value":"127.0.0.1"},{"key":"mail.smtpPort","value":1025},{"key":"mail.from","value":"Roamlog <verify@roamlog.test>"}]}'
curl -X POST http://127.0.0.1:4000/v1/admin/settings/mail/test \
  -H 'content-type: application/json' -d '{"to":"verify@roamlog.test"}'
```

## 7. Known limitation: the worker is not connected

`apps/worker/src/dependencies.ts` still builds its SMTP/Resend transport from
`EMAIL_PROVIDER`, `SMTP_*`, `EMAIL_FROM` and `RESEND_API_KEY` at process start.
Changing mail settings in the Admin console does **not** change worker email
(export-ready notifications). To keep those working, keep the environment
values populated with the same relay/credentials until the worker consumes the
settings through a shared configuration channel. Do not assume "all mail is
wired": only API transactional mail is.