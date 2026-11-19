# Media pipeline (upload, compression, Live Photo)

Status: implemented. Uploads go **browser → S3 with a presigned PUT**; the API
never proxies image bytes. The API validates metadata, the worker derives the
display variants, and every read returns short-lived presigned URLs.

Related files:

- `apps/api/src/modules/media/media-rules.ts` — MIME allow-list, 25 MB still
  cap, 50 MB / 30 s motion caps, object-key rules
- `apps/api/src/modules/media/media.service.ts` — presign, complete, motion
  presign/complete, read projection
- `apps/web/lib/image/compress-image.ts` — browser compression defaults
- `apps/web/lib/image/live-photo-pair.ts` — still/motion pairing rules
- `apps/web/components/media/use-live-photo-upload.ts` — paired upload
- `apps/worker/src/dependencies.ts` (`createImageProcessor`) — sharp variants
- `packages/db/prisma/schema.prisma` — `Media`, `MediaMotion`

## 1. What the browser compresses

Upload surfaces read the four public `media.*` settings through the shared
30-second public-settings cache (`apps/web/lib/settings.ts`,
`useMediaCompressionPolicy`). Code defaults:

| Setting               | Default            | Client clamp | Effect                                    |
| --------------------- | ------------------ | ------------ | ----------------------------------------- |
| `media.maxEdge`       | `2000` px          | 500–4000     | longest edge after resize                 |
| `media.quality`       | `0.82` (WebP)      | 0.4–0.95     | start of the quality ladder (0.82→0.7→0.6→0.55) |
| `media.targetBytes`   | `1_500_000` (1.5 MB) | 100 KB–5 MB | size the ladder aims for                  |
| `media.maxUploadBytes` | `25 MB`           | —            | pre-upload rejection mirror of the API cap |

- Compression runs in a Web Worker when available and falls back to the main
  thread; a canvas re-encode also drops EXIF/GPS from the uploaded bytes.
- The API re-checks independently: a still must be JPEG/PNG/WebP/AVIF/HEIC/HEIF
  and **≤ 25 MB**; nothing trusts the client.
- Changing `media.maxEdge` / `quality` / `targetBytes` / `maxUploadBytes` in the
  Admin console becomes effective for the next upload **within 30 seconds**
  (`PUBLIC_SETTINGS_REVALIDATE_SECONDS = 30`), with no rebuild. Until the first
  fetch resolves, code defaults apply; a settings outage never blocks uploads.
- The UI shows the effective values; do not promise a fixed 2000 px/0.82 in
  operator copy — read the policy.

### Not wired

`media.keepOriginal` and `media.livePhotoEnabled` are **stored but not
consumed**. Changing either does not change upload behavior (the Admin console
labels both “未接入（不生效）”). The uploader has its own local `keepOriginal`
option (component prop / `localStorage` key `roamlog.media.keepOriginal`); it is
not connected to the Admin setting.

## 2. Server-side responsibilities

1. `POST /v1/workspaces/:workspaceId/media/presign` — validates trip/workspace
   membership, MIME and declared size, mints a media id and an object key under
   `{workspaceId}/{yyyy}/{mm}/{mediaId}/original.<ext>`, returns a presigned PUT.
2. `POST /v1/media/:mediaId/complete` — verifies the object exists and is
   non-empty, records `Media`, enqueues variant generation. A second complete is
   idempotent.
3. Worker (`createImageProcessor`) downloads the original once and writes
   `thumb` (400 px), `medium` (1200 px), `large` (2400 px) as WebP plus JPEG
   fallbacks, and a 4×4 blurhash. `sharp(...).rotate()` is used **without**
   `withMetadata()`, so EXIF/GPS is not carried into the derived variants.
   The `original` object is not rewritten by the server — its metadata is
   whatever the browser uploaded.
4. Reads (`GET /v1/.../media`, `GET /v1/media/:mediaId`) return presigned URLs
   for the still, its variants and, when present, the motion clip.

The API is a validator, not an image processor: it does not decode pixels,
resize, or re-encode. A malformed image that passes MIME/size checks is caught
by the worker, which retries a bounded number of times and then leaves the row
without variants (visible as `MEDIA_NOT_READY` on reads).

## 3. Live Photo pairing

iOS exports a Live Photo as two files: the still (`.HEIC`/`.JPG`) and a `.MOV`.
The web has no Live Photo API, so the pair is rebuilt in the browser before
upload (`pairLivePhotos`). Rules, in priority order:

1. same basename (case-insensitive) still + `.MOV` → pair;
2. otherwise, if the still's name contains `live` and exactly one `.MOV` is
   left over, pair them (lenient fallback for renamed exports);
3. one still pairs with at most one movie; extra movies stay unpaired;
4. leftover stills, leftover movies and unknown files stay in `unpaired` and
   must still be uploaded/handled — files are never silently dropped.

Server side:

- `POST /v1/workspaces/:workspaceId/media/:mediaId/motion/presign` — the still
  must exist and belong to the caller/workspace; the motion object key is
  derived from the still's key, so a client cannot point at another object.
- `POST /v1/workspaces/:workspaceId/media/:mediaId/motion` — completes the
  motion: object must be non-empty and the key must belong to that media.
  Limits: `video/quicktime` or `video/mp4`, **≤ 50 MB**, **≤ 30 000 ms**.
- Storage: `MediaMotion` is a **1:1 sibling row** (`mediaId @unique`) holding
  `storageKey`, optional `thumbKey`, `mimeType`, `sizeBytes`, `durationMs`,
  `width`/`height`. Gallery, cover, permissions and deletion all stay on the
  `Media` row, so a paired photo is still one content unit.
- A read with a live motion row returns `livePhoto: true` and `motion.url`; the
  web renders the long-press motion affordance (`LivePhoto`).
- Deleting the still deletes the motion object and row (cascade / key
  collection). A motion-only failure leaves the still usable.

## 4. Verification

```bash
# unit: rules + pairing + motion limits
pnpm --filter @roamlog/api test -- media
pnpm --filter @roamlog/web test -- live-photo
pnpm --filter @roamlog/worker test -- media-motion

# local end-to-end (stack running, MinIO up)
curl -s -X POST "$API/v1/workspaces/$WS/media/presign" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"fileName":"a.jpg","mimeType":"image/jpeg","sizeBytes":123456,"tripId":"'$TRIP'"}'
# PUT the file to uploadUrl, then:
curl -s -X POST "$API/v1/media/$MEDIA/complete" -H "authorization: Bearer $TOKEN" -d '{}'
curl -s "$API/v1/media/$MEDIA" -H "authorization: Bearer $TOKEN"   # variants
```

Expected: read returns signed `original`/`thumb`/`medium`/`large` URLs, the
object counts in MinIO match `variants`, and the logs carry
`media.variants_generated` (or a bounded retry, then a visible failed state).

## 5. Troubleshooting

| Symptom | Check |
| --- | --- |
| `MEDIA_UNSUPPORTED_TYPE` | MIME allow-list; HEIC must arrive as `image/heic`/`image/heif` |
| `MEDIA_TOO_LARGE` | still > 25 MB; motion > 50 MB; client `media.maxUploadBytes` drifted from the server cap |
| `MEDIA_NOT_READY` on read | worker has not finished; check queue depth, sharp install, S3 credentials/endpoint |
| Upload PUT fails with 403 | presigned URL expired, `S3_PUBLIC_ENDPOINT` host mismatch, clock skew, bucket CORS (`MEDIA_CORS_ORIGINS`) |
| Image opens but looks rotated/wrong | EXIF orientation is applied (`rotate()`), metadata is stripped; do not expect EXIF to survive |
| Motion rejected `MEDIA_MOTION_KEY_MISMATCH` | motion presign/complete used different media ids or the client rewrote the key |
| Live Photo shows no motion | motion row missing/`deletedAt` set; check the complete call and `MediaMotion` |

## 6. Known limits

- No server-side re-encode of the `original`; if a client uploads a non-image
  payload with an allowed MIME, only the worker fails, not the presign.
- Variants are fixed (400/1200/2400, WebP + JPEG fallback); there is no
  per-deployment variant ladder.
- Live Photo support is **pairing + playback**, not Apple’s “Live” container
  semantics: the still and the motion are two objects and two uploads.
- `media.keepOriginal` / `media.livePhotoEnabled` do nothing (see §1).
- The 30-second window is best-effort: a client with a cached page can keep
  using old values until its next settings fetch.