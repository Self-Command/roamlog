-- Per-row storage bucket for exports (0011).
--
-- `Export.storageKey` alone does not identify an object once the configured S3
-- bucket changes. The download signer used the *current* bucket, so every
-- export created before a bucket switch stopped downloading (404) even though
-- its object was still in the old bucket. This column records the bucket the
-- object was written to — the value of `StorageService.currentBucket()` when the
-- task was created — mirroring `Media.bucket` from `MEDIA_BUCKET_P0`.
--
-- Additive only: one nullable column, no default, no data rewrite, no table or
-- type change. An empty database and one holding 0010 data migrate identically
-- and every existing `Export` row keeps NULL (the historical behaviour: sign
-- with the current bucket and emit a throttled `export.bucket_missing` warn).
--
-- A NULL bucket is meaningful (row predates this column) and must stay
-- allowed; an empty string is not, because it would silently mean "fall back to
-- current" while looking like a recorded value.

-- AlterTable
ALTER TABLE "Export"
ADD COLUMN "bucket" TEXT;

-- S3 bucket names are non-empty; 255 is the same envelope the media upload
-- path accepts for object keys, so no provider-specific bucket name is rejected.
ALTER TABLE "Export"
ADD CONSTRAINT "Export_bucket_check"
CHECK ("bucket" IS NULL OR length("bucket") BETWEEN 1 AND 255);