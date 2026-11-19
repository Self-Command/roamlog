# DOCS_SYNC — documentation sync report

Status: **DONE**
Task ID: `DOCS_SYNC` (devops)
Date: 2026-11-19
Scope: documentation only. No file under `apps/**`, `packages/**`, `tooling/**`,
`docker/compose*.yml` or any code path was modified.

## 1. Files changed

New:

- `docs/operations/media-pipeline.md`
- `docs/operations/moderation.md`
- `docs/operations/settings.md`

Modified:

- `README.md` — capability list, local verification, env table corrections,
  docs navigation
- `.env.example`
- `docker/production.env.example`
- `docker/staging.env.example`
- `docs/operations/places.md`
- `docs/operations/ai-provider.md`
- `docs/operations/mail.md`
- `docs/operations/README.md` (runbook index)

## 2. Summary

1. **Environment variables.** Every runtime key read by `apps/**`/`packages/**`
   is now documented in all three templates, with purpose, accepted values,
   default and required/optional marker. Places advanced knobs, `REDIS_REQUIRED`,
   `SHUTDOWN_GRACE_MS`, Admin BFF proxy keys and build-time `NEXT_PUBLIC_*`
   values were added; duplicate active keys = none.
2. **Operations docs.** New media/moderation/settings runbooks; places updated
   for the real attribution implementation, no-key degradation and DB-over-env
   precedence; AI doc now spells out the two-phase plan→execute contract, the
   read-only plan guarantee, the tool whitelist and cost magnitude; mail doc
   promotes the worker/env split to a blocking callout.
3. **README truth.** Added only implemented capabilities (AI planner, moderation,
   settings, client compression, Live Photo, Geoapify). No "i18n", "light theme"
   or other unimplemented claims. Local verification points to
   `.audit/local-verify/full-acceptance.sh`.
4. **Consistency.** `已接入后端` = 0 hits. Mock/fixture mentions are migration
   notes or Playwright fixtures; the stale screenshot caption was corrected.

## 3. Variable consistency (template vs code)

Method: extract keys from `EnvironmentSchema`, the `places.*`/`ai.*` accessors,
`AppConfigService` and direct `process.env` reads (tests excluded), then diff
against each template.

```
TEMPLATE .env.example  keys=129  runtime_missing=0
TEMPLATE docker/production.env.example  keys=102  runtime_missing=0
TEMPLATE docker/staging.env.example  keys=110  runtime_missing=0
CODE runtime keys=81  missing_total=0
DUPLICATE(active) .env.example: none
DUPLICATE(active) docker/production.env.example: none
DUPLICATE(active) docker/staging.env.example: none
DOC tokens with no code/template evidence: 0
```

| Family | Code source (verified) | `.env.example` | production | staging | Notes |
| --- | --- | --- | --- | --- | --- |
| `GEOAPIFY_URL`, `GEOAPIFY_TIMEOUT_MS`, `GEOAPIFY_API_KEY`, `GEOAPIFY_DAILY_LIMIT` | `apps/api/src/modules/places/places.settings.ts:131-151` | ✅ | ✅ | ✅ | key optional; empty ⇒ Photon fallback/empty degraded result |
| `PLACES_PROVIDER`, `PLACES_FALLBACK_TO_PHOTON`, `PLACES_LANG`, `PLACES_LIMIT`, `PLACES_CACHE_TTL_SECONDS`, `PLACES_EMPTY_CACHE_TTL_SECONDS` | same file `:107-201` | ✅ | ✅ | ✅ | Admin `places.*` wins once saved (no key env-locked) |
| `PLACES_RATE_LIMIT_MAX`, `PLACES_RATE_LIMIT_WINDOW_SECONDS`, `PLACES_RATE_LIMIT_TIMEOUT_MS`, `PLACES_REDIS_TIMEOUT_MS` | same file `:171-198` | ✅ | ✅ | ✅ | optional, defaults documented |
| `PHOTON_URL`, `PHOTON_TIMEOUT_MS` | same file `:134-135` | ✅ | ✅ | ✅ | fallback provider |
| `AI_PROTOCOL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_DAILY_QUOTA` | `apps/api/src/modules/ai/ai.settings.ts:81-104`, `environment.ts:300-308` | ✅ | ✅ | ✅ | optional group; unconfigured ⇒ 503 |
| `AI_ENABLED` | **not read by API**; read by `tooling/scripts/check-env.ts:502` | ✅ | ✅ | ✅ | preflight-only; template comments corrected |
| `MEDIA_SIGNED_URL_TTL_SECONDS` | `environment.ts:247`, `app-config.service.ts:198` | ✅ | ✅ | ✅ | 60–604800, default 900 |
| `MEDIA_PRESIGN_RATE_LIMIT_MAX`, `MEDIA_CORS_ORIGINS` | `environment.ts:242`, `check-env.ts:140` | ✅ | ✅ | ✅ | bucket CORS is deployment-side |
| `MEDIA_MAX_EDGE`, `MEDIA_QUALITY`, `MEDIA_TARGET_BYTES`, `MEDIA_KEEP_ORIGINAL` | **only `check-env.ts`** — web/API read `media.*` settings instead | ✅ | ✅ | ✅ | labelled preflight-only reference in all templates |
| `S3_PUBLIC_ENDPOINT`, `S3_PUBLIC_BASE_URL` | `environment.ts:272-278`, `storage-settings.ts` | ✅ | ✅ | ✅ | required in production, validated public host |
| `CONFIG_ENCRYPTION_KEY`, `CONFIG_ENCRYPTION_KEYS` | `environment.ts:257-258`, `secret-box.ts:147` | ✅ | ✅ | ✅ | base64 32 bytes; loss = permanent |
| `SHUTDOWN_GRACE_MS` | `apps/api/src/bootstrap/shutdown.ts:20-116` | ✅ | ✅ | ✅ | 0–300000 ms, default 10000; invalid value aborts boot |
| `REDIS_REQUIRED` | `environment.ts:237`, `app-config.service.ts:84` | ✅ | ✅ | ✅ | false = fail-open; true = refuse to boot |
| `NEXT_PUBLIC_API_URL`, `ROAMLOG_API_ORIGIN`, `NEXT_PUBLIC_ADMIN_URL`, `NEXT_PUBLIC_ADMIN_DEMO` | `apps/admin/app/v1/[...path]/route.ts`, `apps/web/components/ai/copy.ts` | ✅ | ✅ | ✅ | Admin BFF proxy / build-time values |

Local-only keys (`DEMO_SEED_ENABLED`, `ROAMLOG_SEED_*`, `MAILPIT_*`,
`ROAMLOG_ENV_FILE`, test/staging harness keys, `ROAMLOG_BUILD_TIME`/version
metadata) are documented in `.env.example` and intentionally not deployment
requirements; production templates state they must never be set there.

### AI_ENABLED decision (deviation from the task wording)

The brief said “if the code does not read it, do not put it in the templates”.
The API indeed does not read `AI_ENABLED` (`resolveAiSettings().configured =
Boolean(baseUrl && model)`), but `tooling/scripts/check-env.ts` **does** read it
and rejects a configured endpoint while `AI_ENABLED=false`. Removing the key
would make the preflight warn on a correct configuration and would break the
documented disable procedure. Kept in all three templates, but every comment now
states **preflight-only** and that disabling AI requires emptying
`AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`. This is also called out in
`docs/operations/ai-provider.md` §1 and `README.md`.

## 4. Verification (raw)

```
$ node /tmp/envcheck.mjs
TEMPLATE .env.example  keys=129  runtime_missing=0
TEMPLATE docker/production.env.example  keys=102  runtime_missing=0
TEMPLATE docker/staging.env.example  keys=110  runtime_missing=0
CODE runtime keys=81  missing_total=0
DUPLICATE(active) .env.example: none
DUPLICATE(active) docker/production.env.example: none
DUPLICATE(active) docker/staging.env.example: none
DOC tokens with no code/template evidence: 0
```

```
$ rg -n "已接入后端" docs README.md
(no output, exit 1)                         # 0 hits

$ rg -ni "live api|fixture|mock 模式" docs README.md
README.md:46   … mock/fixture 模式已移除 …                 # migration note
README.md:344  … 没有 mock / fixture 模式 …               # migration note
README.md:535  pnpm e2e:live                              # live E2E, not a mode
README.md:545  live/staging 命令依赖 … fixture …          # test fixtures
README.md:616  live API | pnpm e2e:live … 真实 fixture     # test fixtures
README.md:642  不要用 mock 模式替代                         # migration note
docs/architecture.md:84,110  packages/api-mocks …          # Playwright fixtures
docs/superpowers/**  Stage A plan/spec                     # migration design docs
```

```
$ for f in .env.example docker/production.env.example docker/staging.env.example; do
    rg -o '^[A-Z][A-Z0-9_]*=' "$f" | sed 's/=$//' | sort | uniq -d; done
(no output for all three files)              # no duplicate active keys

$ pnpm staging:validate
Staging static checks passed: compose YAML, environment templates, Dockerfiles,
workflow gate, and shell syntax.
exit 0

$ pnpm exec tsx tooling/scripts/check-env.ts --env local --env-file .env.example
Environment configuration looks valid.
exit 0
```

## 5. CodeGraph evidence

- `codegraph status` → `[OK]`, 1,741 files / 27,130 nodes / 61,915 edges (index
  was current before and after the change; docs-only edits do not affect it).
- `codegraph_explore "environment.ts env schema app-config.service places
  settings ai settings media rules secrets encryption"` → 93 symbols across
  5 files; confirmed `EnvironmentSchema` keys (`REDIS_REQUIRED`,
  `MEDIA_SIGNED_URL_TTL_SECONDS`, `S3_PUBLIC_*`, `CONFIG_ENCRYPTION_*`, `AI_*`),
  `resolvePlacesSettings` defaults and `SecretBox.fromEnvironment`.
- `codegraph_explore "admin-reports.service resolve applyModerationToTarget
  buildAdminReportItems SETTINGS_REGISTRY resolvePlacesSettings
  resolveAiSettings"` → 37 symbols across 3 files; confirmed
  `applyModerationToTarget` restore predicate `moderatedAt: { not: null }`,
  `buildAdminReportItems` snapshot/count query, `resolvePlacesSettings` env
  mapping, and `resolveAiSettings.configured = Boolean(baseUrl && model)`.
- Blast radius captured for `applyModerationToTarget` (2 callers, 2 test files)
  and `SETTINGS_REGISTRY` (10 callers incl. `settings.service`,
  `storage.module`, `settings-save-probe`).

## 6. Known risks

1. **AI_ENABLED is a preflight switch, not an API switch.** Operators may set
   `AI_ENABLED=false` and still be billed if endpoint values remain. Templates,
   README and the AI runbook now say this three times; enforcement would need a
   code change (out of scope).
2. **Admin settings badges for `mail` and `storage` are stale.** Runtime truth
   (new consumers `mail-settings.consumer.ts`, `storage-settings.consumer.ts`)
   says the API consumes them; `apps/admin/lib/admin-settings.ts` still labels
   them “未接入”. `docs/operations/settings.md` follows the runtime and records
   the UI lag; the UI fix is a code task.
3. **`MEDIA_*` reference vars are not runtime inputs.** A deployer changing
   `MEDIA_MAX_EDGE` in the env file will see no effect (Admin `media.*` wins).
   Corrected in all templates and README; the old wording is gone.
4. **`.audit/local-verify/full-acceptance.sh` is untracked.** README now points
   at it; if the owning agent does not commit it, the link breaks. Not added
   here because `.audit/` is shared and the script belongs to QA.
5. **Concurrent edits.** `apps/web/components/media/use-live-photo-upload.ts`
   and `apps/web/components/moderation/api.ts` were being edited during this
   task; docs describe the current on-disk contract, not a frozen release.

## 7. Not covered

- `bash .audit/local-verify/full-acceptance.sh` was not run: it needs a local
  PostgreSQL test database (`127.0.0.1:55444`) and runs the full build/E2E gate,
  which is outside a docs-only change.
- Production strict preflight was not exercised against the template because it
  intentionally fails on `CHANGE_ME` placeholders (documented behavior).
- No browser/visual verification of the docs (Markdown only).

## 8. Suggested next steps

1. Wire (or remove) `AI_ENABLED` in the API so the preflight switch and runtime
   agree; until then keep the current warning.
2. Refresh `SETTINGS_CONSUMPTION` for `mail`/`storage` in the Admin UI.
3. Commit `full-acceptance.sh` and reference it from `docs/operations/README.md`.
4. Add a CI docs check for “every env key in a template exists in code and vice
   versa” (the `/tmp` checker used here is a 60-line Node script and can be
   promoted to `tooling/scripts/check-docs-env.mjs` by its owner).