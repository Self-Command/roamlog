# System settings (Admin console)

Status: implemented. 45 keys in 9 groups, one immutable registry, encrypted
secret storage, audited reveal, and a public projection for anonymous pages.
Some keys are stored but **not consumed** by any runtime — this page lists that
honestly, group by group.

Related files:

- `apps/api/src/modules/settings/settings.registry.ts` — the single source of
  truth (group, type, default, schema, `isPublic`, `isSecret`)
- `packages/db/src/settings-defaults.ts` — `DEFAULT_SETTINGS` (a key without a
  default fails at module load)
- `apps/api/src/modules/settings/settings.service.ts` — read/write, precedence,
  cache, secrets, reveal, audit
- `apps/api/src/modules/settings/secret-box.ts` — AES-256-GCM envelope
- `apps/api/src/modules/settings/public-settings.controller.ts` — anonymous
  projection
- `apps/admin/components/settings/settings-consumption.ts` — the Admin UI’s
  field-level “已消费 / 未接入” labels
- `packages/contracts/src/api/admin-settings.ts`

## 1. Groups and keys

| Group (9) | Keys (45) | Consumption |
| --- | --- | --- |
| `general` (5) | `site.title`, `site.description`, `general.defaultLanguage`, `general.defaultTimeZone`, `general.registrationEnabled` | **frontend** for title/description/language/time zone; `general.registrationEnabled` **未接入** |
| `seo` (5) | `seo.titleTemplate`, `seo.descriptionTemplate`, `seo.ogImageUrl`, `seo.robots`, `seo.sitemapEnabled` | **frontend** for the first four; `seo.sitemapEnabled` **未接入** |
| `theme` (3) | `theme.accent`, `theme.defaultMode`, `theme.loginTagline` | **frontend** |
| `mail` (7) | `mail.provider`, `mail.from`, `mail.resendApiKey`, `mail.smtpHost`, `mail.smtpPort`, `mail.smtpUser`, `mail.smtpPassword` | **backend**: all seven keys are resolved by `MailSettingsConsumer` in the API; **worker 未接入** (still reads `EMAIL_*`/`SMTP_*`, so `mail.*` does not affect worker-sent export notifications) |
| `storage` (7) | `storage.endpoint`, `storage.publicEndpoint`, `storage.bucket`, `storage.region`, `storage.accessKey`, `storage.secretKey`, `storage.forcePathStyle` | **backend**: resolved by `StorageSettingsConsumer` in the API; a save runs a connectivity probe before it persists; **worker 未接入** (still reads `S3_*`) |
| `media` (6) | `media.maxEdge`, `media.quality`, `media.targetBytes`, `media.maxUploadBytes`, `media.keepOriginal`, `media.livePhotoEnabled` | **frontend 4/6**; `keepOriginal` and `livePhotoEnabled` **未接入（不生效）** |
| `ai` (4) | `ai.defaultProvider`, `ai.timeoutMs`, `ai.maxOutputTokens`, `ai.dailyQuota` | **backend** (resolved per request by `AiModule`) |
| `places` (6) | `places.provider`, `places.apiKey`, `places.lang`, `places.limit`, `places.cacheTtlSeconds`, `places.dailyQuota` | **backend** (resolved per request by `PlacesModule`) |
| `limits` (2) | `limits.searchPerMinute`, `limits.uploadPerMinute` | `searchPerMinute` **backend** (place search limiter); `uploadPerMinute` **未接入** (presign still reads `MEDIA_PRESIGN_RATE_LIMIT_MAX`) |

Notes:

- The Admin UI shows a group badge plus field-level exceptions. `mail` and
  `storage` badges are `backend` because `SettingsService` really is read at
  runtime; the badge label carries the remaining limit instead of hiding it
  (“worker 仍读环境变量” for mail, “保存前会跑连通性探测” for storage), and all
  seven `mail.*` fields say the worker export path is not wired.
- `ai.*` and `places.*` have no API keys/endpoints in the registry: provider
  URL, protocol, API key and model stay environment-only by design. Only the
  four tuning values and the six places values are editable at runtime.
- `mail.*` values win over `EMAIL_*`; `storage.*` win over `S3_*` in the API
  only. In the worker, environment is still the only source.

## 2. Precedence and caching

Per key, highest first:

1. environment, **only if** the registry marks the key `envLocked` with an
   `envVar` (today **no key is locked**; the mechanism exists for deployments
   that need to freeze a value);
2. value saved through `POST /v1/admin/settings`;
3. environment fallback (`EMAIL_*`, `S3_*`, `AI_*`, `PLACES_*`, … where wired);
4. code default from `DEFAULT_SETTINGS`.

- Reads are cached in-process for **5 seconds**; a write bumps a Redis
  generation that other instances observe (pub/sub), so a change normally
  lands within the cache window.
- `GET /v1/public/settings` returns `isPublic && !isSecret` keys only; the web
  app revalidates it every **30 seconds**. An admin change can therefore take
  up to 30 s to reach a cached public page.
- A settings outage must not take pages down: the web falls back to code
  defaults.

## 3. Secrets: write-only, then audited reveal

Five keys are `isSecret`: `mail.resendApiKey`, `mail.smtpPassword`,
`storage.accessKey`, `storage.secretKey`, `places.apiKey`.

- They are encrypted with AES-256-GCM before the row is written. The ciphertext
  envelope is versioned and carries a key id: `v1:<keyId>:<base64>`.
- Reads never return plaintext. An item exposes only
  `secret: { hasValue, last4 }` (last 4 characters for operator recognition).
- Saving a secret requires `CONFIG_ENCRYPTION_KEY`; without it the write fails
  with `SETTINGS_ENCRYPTION_UNAVAILABLE` instead of storing plaintext.
- Updating a secret is write-only: an empty field means “leave unchanged”, not
  “clear”. There is no delete-secret endpoint today.

### Reveal flow

```http
POST /v1/admin/settings/:key/reveal
{ "confirm": true }
```

Server-side checks, in order:

1. caller is `super_admin` **and** has `admin:settings:read`;
2. the key exists and `isSecret` (non-secret → `422 SETTINGS_NOT_SECRET`);
3. `confirm: true` is present (otherwise `403 SETTINGS_REVEAL_FORBIDDEN`);
4. the caller has 2FA enabled **and** a verified TOTP factor
   (`two_factor_required`);
5. a stored ciphertext exists (else `404 SETTING_SECRET_NOT_CONFIGURED`);
6. decryption succeeds with the current key ring.

Every successful reveal writes `admin.settings.revealed` with
`metadata: { key }` — never the value. The Admin dialog warns that the action is
audited; the plaintext auto-hides after 10 seconds **in the browser** (the
server response itself has no expiry). The value is not logged, not cached in
the API, and not part of `GET /v1/admin/settings`.

## 4. Encryption key operations

```bash
openssl rand -base64 32          # exactly 32 bytes, base64
```

- `CONFIG_ENCRYPTION_KEY` — current key. Required when `APP_ENV=production`;
  validated at boot (base64, 32 bytes) and by `pnpm check:env -- --env production`.
- `CONFIG_ENCRYPTION_KEYS` — optional comma-separated ring for rotation; the
  **first** entry is used to encrypt, the rest can still decrypt.
- Rotation: prepend the new key, keep the old one, restart, re-save every secret
  (or decrypt+rewrite through the API), verify no row references the old key id,
  then drop the old key. Removing a key that still encrypts a row makes that
  secret undecryptable (`SECRET_DECRYPT_FAILED`).

> **Losing `CONFIG_ENCRYPTION_KEY` (and every key in the ring) makes all saved
> secrets permanently undecryptable.** There is no recovery path, escrow, or
> “reset ciphertext” endpoint. Database backups contain ciphertext only. Store
> the key in the deployment's secret manager and in the offline recovery kit;
> the key must never be committed or written into a ticket.

## 5. Verify a change took effect

```bash
# read (secrets as state only)
curl -s "$API/v1/admin/settings" -H "authorization: Bearer $ADMIN"

# read shape: { groups: [ { group, label, items: [...] } ], generatedAt }
curl -s "$API/v1/admin/settings" -H "authorization: Bearer $ADMIN" \
  | jq '.groups[] | select(.group=="media") | .items[] | {key, value, source, secret}'

# write one key
curl -s -X PATCH "$API/v1/admin/settings" -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"updates":[{"key":"media.quality","value":0.8}]}'

# anonymous projection (what the web reads)
curl -s "$API/v1/public/settings" | jq '.settings["media.quality"]'

# a secret: state, then explicit audited reveal
curl -s "$API/v1/admin/settings" -H "authorization: Bearer $ADMIN" \
  | jq '.groups[].items[] | select(.key=="mail.smtpPassword") | .secret'
curl -s -X POST "$API/v1/admin/settings/mail.smtpPassword/reveal" \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"confirm":true}'
```

Expected: the public projection changes within 30 s; the DB row carries
`secretCipher` (never plaintext); the audit log has `admin.settings.updated`
and, for a reveal, `admin.settings.revealed`.

## 6. Failure modes

| Symptom | Meaning / action |
| --- | --- |
| `SETTINGS_ENCRYPTION_UNAVAILABLE` on save | `CONFIG_ENCRYPTION_KEY` missing/invalid; set a 32-byte base64 key and restart |
| `SECRET_DECRYPT_FAILED` on read/reveal | current key ring does not contain the key that encrypted the row; restore the old key, do not re-save blindly |
| `SETTING_ENV_LOCKED` on write | the key is env-locked (none today, possible after a deployment locks one) |
| `SETTINGS_KEY_NOT_FOUND` | unknown key; the registry rejects unknown writes |
| `422 SETTINGS_NOT_SECRET` on reveal | only `isSecret` keys can be revealed |
| `403 two_factor_required` on reveal | enable 2FA for the admin account; TOTP must be verified |
| `SETTINGS_SECRET_NOT_CONFIGURED` | no stored value yet (or env-only value); reveal has nothing to return |
| A key “saved” but behavior unchanged | check the group table in §1 — it may be one of the unwired keys |
| Change visible on API but not on the page | wait 30 s (public projection), or the page is a static build; no rebuild is needed |

## 7. Known limits

- 5 keys are stored but not consumed: `general.registrationEnabled`,
  `seo.sitemapEnabled`, `media.keepOriginal`, `media.livePhotoEnabled`,
  `limits.uploadPerMinute`. Do not present these as working switches.
  `mail.*` and `storage.*` reach the API but not the worker; that split is
  spelled out in the Admin labels and in §1.
- No per-key history/rollback: the audit log records the event, not the previous
  value.
- No secret deletion; rotating to a new value overwrites the old one.
- The 5-second in-process cache and the 30-second public cache mean “instant”
  changes are not instant across all surfaces.
- `mail`/`storage` group badges now mirror the runtime; the worker gap is part
  of the label rather than a separate stale-badge bug.