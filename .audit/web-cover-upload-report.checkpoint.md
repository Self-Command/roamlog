# WEB_COVER_UPLOAD checkpoint — COMPLETE

Task: real end-to-end trip cover upload (web), delivered as an independent
`components/media` module with integration notes instead of touching the
`trip-form` directory.

## Preconditions

- `codegraph status` initially dirty (3 added / 5 modified from parallel agents);
  `codegraph sync` was blocked by the watcher lock (PID 4296), but the watcher
  finished it — status then `[OK] Index is up to date` (1,385 files).
- Explore #1 (`presign complete media usePresignedUpload ...`) proved
  `usePresignedUpload` does not exist; real chain is generated
  `presignMediaUpload` → PUT uploadUrl → `completeMediaUpload` → `getMedia` →
  `setTripCover`.
- Explore #2 proved clearing goes through `PATCH /v1/trips/{id}` with
  `coverMediaId: null` + optimistic `version`.

## Server facts

- presign: `POST /v1/workspaces/{workspaceId}/media/presign` →
  `{mediaId, uploadUrl, method:"PUT", headers, expiresAt}`; no bucket/key exposed.
- complete: `POST /v1/media/{mediaId}/complete` → processing + worker enqueue.
- status: `GET /v1/media/{mediaId}` already exists in `media.controller.ts:98`
  and returns signed `url`/`thumbUrl` only when ready.
- set cover: `POST /v1/trips/{tripId}/cover`, non-ready → 409 `MEDIA_NOT_READY`.
- clear: `PATCH /v1/trips/{tripId}` `{version, coverMediaId:null}`.
- limits: 25 MiB, jpeg/png/webp/avif/heic/heif.

## Delivered

- `apps/web/lib/api/media.ts` — contract-validated client seam + XHR PUT progress.
- `apps/web/components/media/cover-upload-error.ts` — classified errors with
  `code`/`serverCode`/`detail`/`resumeAt`/`retryable`.
- `apps/web/components/media/cover-upload-validation.ts` — server-aligned limits.
- `apps/web/components/media/use-cover-upload.ts` — state machine
  idle → validating → presigning → uploading → completing → processing →
  applying → ready | error, backoff polling (1s → 4s, 60s cap), phase-accurate retry.
- `apps/web/components/media/cover-uploader.tsx` — click/drag, local preview with
  revoke, replace/remove, truthful empty & processing states, aria-live/alert,
  reduced-motion safe, HEIC preview fallback.
- `apps/web/components/media/index.ts` — exports.
- `apps/web/test/cover-upload-doubles.ts` + 4 test files (45 tests).
- `.audit/web-cover-upload-report.md` — full delivery + integration snippet.

## Verification

- `vitest run components/media` → 3 files / 34 tests passed.
- `vitest run lib/api/media.test.ts` → 1 file / 11 tests passed.
- combined → 4 files / 45 tests passed.
- `pnpm --filter @roamlog/web typecheck` → 0 errors at 22:03:37 (before the other
  agent resumed editing); final run has 5 errors, all in
  `components/trips/trip-form/trip-form.tsx`, none in my files.
- eslint on my files → clean.

## Deliberate non-goals / risks

- Not mounted in production: every mount point belongs to other agents
  (`trip-form`, `trips/new|edit`, `trip-detail`). Integration snippet included.
- mock mode has no media handlers; upload only works with `NEXT_PUBLIC_DATA_MODE=api`.
- Removal clears `coverMediaId`, does not delete the media asset.
- No build/dev-server run (forbidden / port risk).

## CodeGraph

`codegraph explore "CoverUploader useCoverUpload createCoverMediaClient
putObjectToSignedUrl clearCover"` → 64 symbols / 4 files, flow
`CoverUploader → useCoverUpload → createCoverMediaClient`, index
`[OK] Index is up to date` (1,426 files) after a final sync.