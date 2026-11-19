# Settings encryption key

Status: implemented by `B1A` (`apps/api/src/modules/settings/secret-box.ts`).
This is a **production blocker**: the production preflight refuses to pass
without a valid `CONFIG_ENCRYPTION_KEY`.

Related files:

- `apps/api/src/config/environment.ts` — boot-time validation of both variables
- `apps/api/src/modules/settings/secret-box.ts` — AES-256-GCM envelope and key ring
- `apps/api/src/modules/settings/settings.service.ts` — the only writer/reader
- `tooling/scripts/check-env.ts` — production preflight that fails without the key
- `docker/production.env.example`, `docker/staging.env.example`, `.env.example`

## 1. What the key protects

Admin → Settings stores `type: "secret"` settings encrypted at rest (not in
plaintext JSONB). Today that is exactly:

| Setting key         | Secret                     |
| ------------------- | -------------------------- |
| `mail.resendApiKey` | Resend API key             |
| `mail.smtpPassword` | SMTP password              |
| `storage.accessKey` | S3/MinIO access key id     |
| `storage.secretKey` | S3/MinIO secret access key |
| `places.apiKey`     | Geoapify API key           |

Any `secret` setting added later uses the same envelope. Non-secret settings
remain plaintext and are not affected by this key.

Ciphertext format is `v1:<keyId>:<base64(iv|ct|tag)>`:

- AES-256-GCM, 12-byte IV, 16-byte tag, random IV per write.
- `<keyId>` is the first 8 hex characters of `SHA-256(key)`; it lets the API
  pick the right key from the ring without storing the key.
- The setting key (for example `mail.smtpPassword`) is the AAD, so ciphertext
  copied onto another setting row fails authentication instead of decrypting.
- `SystemSetting.secretCipher` holds the envelope, `secretLast4` the masked
  hint, `keyVersion` the 1-based ring position.

## 2. Required value

- Exactly **32 bytes**, base64 encoded (44 characters including padding).
- Generate once per deployment:

  ```bash
  openssl rand -base64 32
  ```

- Every API replica that writes settings must receive the **same** value; the
  key is not generated per container and must never be "fixed" by deleting the
  old one.
- Store it in the approved password manager and in an off-host backup that is
  **separate from the database backup** (a database restore does not restore a
  lost key).
- Never commit it, paste it into a ticket, chat, Sentry, or a shell history
  that is shared. `check-env` never prints the value.

`CONFIG_ENCRYPTION_KEYS` is optional. When set, it is a comma-separated key
ring whose **first entry is the current encryption key**; the remaining entries
are decrypt-only history. `CONFIG_ENCRYPTION_KEY` remains a valid standalone
current key and, when both variables are set, is kept as an additional
decrypt-only fallback so a half-finished rotation still reads.

## 3. Failure modes

| Condition                                             | Effect                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `APP_ENV=production`, key missing                     | `pnpm check:env -- --env production ...` exits `1`; first secret save answers `503 SETTINGS_ENCRYPTION_UNAVAILABLE`            |
| Key present but not canonical base64 / not 32 bytes   | `validateEnvironment()` rejects it at API boot, so the API does not start; preflight also exits `1` with the generate command  |
| Key ring does not contain the key that wrote a secret | Reading that secret answers `500 SETTINGS_SECRET_UNREADABLE`; the API logs `settings.secret_unreadable` with the envelope code |
| Key lost after data was written                       | **Every stored secret is permanently undecryptable. There is no recovery path.**                                               |

Local development may leave the key empty: the API still boots, and saving a
secret fails loudly with `SETTINGS_ENCRYPTION_UNAVAILABLE` instead of silently
storing plaintext. To exercise the settings UI locally:

```bash
openssl rand -base64 32   # put the result in .env.local as CONFIG_ENCRYPTION_KEY
```

## 4. Losing the key means losing the secrets

The ciphertext is only recoverable with the exact key bytes. There is no
master-key escrow, no re-derivation from `BETTER_AUTH_SECRET`, and database
backups contain only ciphertext. If the key is lost:

1. Restore the key from the password manager / offline backup if it exists.
2. If it truly does not exist, generate a new key and set it, then **re-enter
   every secret** in Admin → Settings (Resend key, SMTP password, S3 access and
   secret keys, Geoapify key). Old rows cannot be decrypted; the UI reports
   them as unreadable until overwritten.
3. Treat the event as a security incident: rotate every credential that was
   stored in those rows, because the plaintext may still exist in a provider
   dashboard or an old ticket.

## 5. Rotation (zero-downtime key ring)

Use this when the key must be replaced (staff departure, suspected exposure,
scheduled rotation). Do **not** replace `CONFIG_ENCRYPTION_KEY` in one step
while ciphertext exists.

1. Generate the new key: `openssl rand -base64 32`.
2. Set the ring with the new key first and the old key retained:

   ```dotenv
   CONFIG_ENCRYPTION_KEYS=<new>,<old>
   CONFIG_ENCRYPTION_KEY=<old>
   ```

   `CONFIG_ENCRYPTION_KEYS` is authoritative for the current key, so new writes
   use `<new>`; `<old>` stays available for decrypt.

3. Restart every API replica (rolling restart is fine; all replicas must see
   the new ring before step 4).
4. Re-save every secret setting in Admin → Settings with its real value, so the
   row is re-encrypted with the new current key. The UI shows a masked value;
   typing the same value again and saving is what rewrites the ciphertext.
5. Confirm no row still references the old key id:

   ```sql
   SELECT substring("secretCipher" from '^v1:([0-9a-f]{8}):') AS key_id,
          min("keyVersion") AS key_version,
          count(*) AS rows
   FROM "SystemSetting"
   WHERE "secretCipher" IS NOT NULL
   GROUP BY 1;
   ```

   The new key id can be computed from the key without printing it:

   ```bash
   printf '%s' "$CONFIG_ENCRYPTION_KEY" | base64 -d \
     | openssl dgst -sha256 -binary | xxd -p -c 32 | cut -c1-8
   ```

6. Only when every row shows the new key id, remove the old key:
   `CONFIG_ENCRYPTION_KEYS=<new>` (or leave only `CONFIG_ENCRYPTION_KEY=<new>`),
   restart, and save/read one secret to verify.
7. Keep the old key in the password manager for at least one verified backup
   restore window. Removing it before all ciphertext is migrated makes those
   rows unrecoverable.

Rows that were never re-saved keep the old `keyId`; that is expected during the
overlap and is why the old key must stay until the query above is clean.

## 6. Verification

```bash
# production preflight: must exit 0 and print "Environment configuration looks valid."
pnpm check:env -- --env production --env-file /opt/roamlog/config/.env.production
```

Then:

1. Save a test secret in Admin → Settings and read it back after an API
   restart; it must decrypt.
2. Send a test mail through the configured provider (proves
   `mail.smtpPassword` / `mail.resendApiKey` decrypt).
3. Confirm the key exists in the password manager and in the off-host backup,
   and that a restore drill can read it.
4. Record who rotated, when, why, and the SQL output from step 5 above.
