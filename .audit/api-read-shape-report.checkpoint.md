# API_READ_SHAPE checkpoint — make api runtime reads satisfy the new read contract

- repo: `C:\Users\BY9700\Desktop\UI\roamlog` (Windows Git Bash)
- task: API_READ_SHAPE (backend_api)
- CodeGraph: `codegraph status` -> `[OK] Index is up to date` (1,339 files / 19,718 nodes / 41,594 edges)
- git: working tree already dirty from other agents (`packages/contracts`, `packages/api-client`, `apps/admin`, `apps/web`). I only touch the files listed in the task pack; no reset/clean/checkout/stash, no commit, no codegen.

## Contract facts read (source of truth, current on-disk)
- `entities/trip.ts`: `TripSchema` requires `durationDays` (inclusive span, cross-checked by `tripDurationDays()`), `cover` (nullable `TripCoverSchema`), and nullable `originLat` / `originLng` / `originCountryCode` / `timeZone`; `originLat`/`originLng` must be both null or both set.
- `entities/stop.ts`: `StopSchema` requires nullable `provider` (`photon|local`), `providerPlaceId`, `timeZone`.
- `api/share-links.ts`: `PublicTripSchema` requires `durationDays` + `cover`; `PublicMediaSchema` is `.strict()` and requires `id,url,thumbUrl,expiresAt,width,height,blurhash,caption,date,location` — `variants/bucket/key` now rejected.
- `api/media.ts`: `MediaReadSchema` = `MediaSchema` minus bucket/key/variants plus `url/thumbUrl/expiresAt`; `GetMediaResponseSchema = MediaReadSchema`; list pages still use `MediaSchema`.

## Decisions
- `presentTrip`: compute `durationDays` with `tripDurationDays()` from the presented dates; pass through optional `originLat/originLng/originCountryCode/timeZone` (null when absent) so the W0_DB migration flows through Prisma rows without a second presenter change; `cover: null` because a real cover projection needs signed cover media that this task does not own.
- `presentStop`: optional `provider/providerPlaceId/timeZone` -> null defaults, otherwise verbatim (no invented provider ids).
- New `MediaUrlService` in `apps/api/src/modules/media/` reusing the existing `StorageService.createSignedReadUrl` (S3 `@aws-sdk/s3-request-presigner`, already used by `MediaService.presentWithUrls`); signs only the keys needed for `url` (large, then original) and `thumbUrl` (thumb, then display key), returns `{url,thumbUrl,expiresAt}` with no bucket/key, and never signs non-`ready` media.
- `share-links.service.publicPayload` becomes async: signs public media once per response, drops non-ready / URL-less rows instead of emitting empty strings, and emits the strict `PublicMedia` shape.
- Not doing: adding `GET /v1/media/{mediaId}` (declared in the OpenAPI contract, no Nest route today) — that is route work outside this task pack; reported as uncovered, service is ready for it.

## Progress
- [x] codegraph gate + contract read
- [x] content-presenters
- [x] media-url service + module export
- [x] share-links payload/media projection + module wiring
- [x] tests (25 passed / 4 files)
- [x] typecheck (only pre-existing places/__tests__ TS2742 from another agent's untracked module)
- [x] report written -> `.audit/api-read-shape-report.md`
