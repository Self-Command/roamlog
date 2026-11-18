# W0_STORAGE_INFRA — checkpoint

Task: make production media browser-reachable (signed URLs currently point at `http://minio:9000`) and tighten media write authorization.
Status: DONE (2026-11-18T21:20+08:00) — see `.audit/w0-storage-report.md` for the full deliverable.
Started: 2026-11-18T21:04+08:00

## Prerequisite gate

- `codegraph status` -> "Pending Changes: Modified: 3 files" (not `[OK]`) -> ran `codegraph sync`
  -> `Synced 3 changed files`, status clean afterwards (see final report for exact output).
- `codegraph_explore "StorageService createS3Client createSignedReadUrl StorageSettings S3_ENDPOINT media presign"`:
  hit `storage.service.ts:44 createS3Client`, `storage.service.ts:144 createSignedReadUrl`
  (callers: `exports.service.ts`, `media.service.ts`, `media-url.service.ts`), `media-url.service.ts:51 sign`,
  `media.service.ts:56 presign`, `media.controller.ts:44 presign`.

## Write-contention check (before touching media module)

`git status --porcelain apps/api/src/modules/media`:
- ` M media.module.ts`, ` M media.presenter.ts`
- `?? media-url.service.ts`, `?? media-url.module.ts`, `?? trip-cover.service.ts`
- **`media.service.ts` NOT modified and mtime 2026-11-17 19:19** (module siblings edited 2026-11-18 20:41-20:43).

Decision: media.service.ts is clean vs HEAD and untouched for ~1h50m while API_TRIP_MEDIA edits sibling
files -> treat as not-in-progress, apply the minimal authz fix (private-trip visibility on update/remove),
and flag the exact diff to the parent so it is not clobbered by a later rewrite.

`apps/api/src/config/environment.ts` + `environment.spec.ts` are dirty (W0_MAIL, 20:39) -> edit
additively, never rewrite the mail rules.

## Audit findings (media write authorization)

Confirmed gap (medium): `remove` / `update` do not verify the *current* trip visibility, while
`complete` does (`media.service.ts:136-141`) and `presign` does (`media.service.ts:66-75`).
An editor is excluded from private trips by `listWorkspace.visibilityFilter` but can still
`DELETE /v1/media/:id` / `PATCH /v1/media/:id` a media row of a private trip they cannot see, if the id is known.
Patch: extract the complete() check into `assertMediaVisible()` and call it from `update` and `remove`.

Non-blocking observations (report only):
- Presigned PUT does not sign Content-Length; the 25 MB cap is only enforced in `complete` (HEAD re-check),
  so an oversized object can be stored and left orphaned (`MEDIA_TOO_LARGE` afterwards).
- `presign` is not idempotent (only `complete` accepts `Idempotency-Key`); repeated calls create pending rows.
- No cleanup job for `pending` media rows that are never completed.

## Plan

1. `storage-settings.ts`: add optional `publicEndpoint`, `publicBaseUrl`, `mediaSignedUrlTtlSeconds` (optional keeps
   `apps/api/test/storage*.e2e-spec.ts` literals type-valid).
2. `environment.ts`: `S3_PUBLIC_ENDPOINT`, `S3_PUBLIC_BASE_URL`, `MEDIA_SIGNED_URL_TTL_SECONDS` (900, 60-604800),
   APP_ENV=production gate (https + non-internal host), fallback to `S3_ENDPOINT`, no secret echo.
3. `app-config.service.ts`: additive getters + storageSettings fields (small boundary deviation, disclosed).
4. `storage.service.ts`: internal `client` vs `signingClient`; both presign paths use `signingClient`; keep cap/keys.
5. Tests: `src/modules/storage/storage.service.spec.ts` + `src/config/environment.spec.ts`.
6. Docker: CORS via `mc cors set` (pinned mc RELEASE.2025-08-13 supports it, verified from mc source), compose env.
7. Nginx `deploy/nginx/media.conf.example` (Host passthrough is the whole point), CSP check, Cloudflare notes.
8. `docs/operations/media-delivery.md`.

## Environment limits

No `docker`, no `nginx`, no `mc`, no local MinIO on this host -> nginx -t and live presign/PUT/GET cannot run.
Offline proof instead: assert `X-Amz-SignedHeaders=host` and that the signature differs per endpoint host.
## Final outcome (2026-11-18T21:20+08:00)

- Storage/config/tests: DONE. `vitest run src/config src/modules/storage` -> 41/41 pass;
  full `vitest run src` -> 277/277 pass.
- `pnpm --filter @roamlog/api typecheck`: only `test/content-trips.e2e-spec.ts(45,19) TS2554`
  (API_TRIP_MEDIA changed `TripsService` arity; file outside my write scope). Zero errors in my files.
- MinIO CORS: `mc cors set` (pinned mc RELEASE.2025-08-13 supports it — verified from mc source
  upstream), idempotent, read-back verified, non-zero on every failure path; exercised with an
  `mc` stub (10 cases).
- Nginx media block: written, structurally linted; `nginx -t` NOT run (no binary on host).
- Live MinIO presign -> PUT/GET NOT run (no docker/mc/MinIO on host) — stated as uncovered.
- media.service.ts minimal authz fix applied (file was clean vs HEAD, mtime 1h50m old at edit time).
- Two disclosed boundary deviations: `app-config.service.ts` wiring (required for the feature to
  work at all) and `media.service.ts` fix (explicitly authorised by the task when not in flight).
- CodeGraph: `[OK] Index is up to date` after final sync.
