-- Photo EXIF read on the client before compression (0014).
--
-- The upload pipeline turns the source `File` into a WebP derivative through a
-- canvas re-encode; that derivative carries none of the source EXIF, and the
-- original is never uploaded, so metadata has exactly one chance to survive:
-- the browser reads it from the raw `File` and submits it with the existing
-- `complete` callback. There is no second upload, and no server-side re-read.
--
-- Additive by design:
--   * `Media` gains three nullable columns (`exif` JSONB, and the denormalized
--     WGS-84 `lat`/`lng` pair for map queries);
--   * `Trip` gains one boolean with a `true` default (the Owner switch for the
--     public share page);
--   * two new indexes on the coordinate pair.
-- No column is retyped, no row is deleted or rewritten, and no existing column
-- changes meaning: every historical photo keeps `exif = NULL` (its original
-- file is gone, so it cannot be backfilled) and every historical trip keeps
-- the *show* behaviour the product decided on, because the default is `true`.

-- AlterTable
ALTER TABLE "Media" ADD COLUMN "exif" JSONB;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN "lat" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN "lng" DOUBLE PRECISION;

-- The coordinate pair is always written together, so a half-populated position
-- (one of the two null, or both set on a photo with no metadata) would be a bug
-- in the uploader, not a legitimate state. Reject it at the catalog level.
-- GPS coordinates are WGS-84 and are never converted to a projected CRS.
-- AlterTable
ALTER TABLE "Media" ADD CONSTRAINT "Media_exif_location_check"
  CHECK (
    (lat IS NULL AND lng IS NULL)
    OR (
      lat IS NOT NULL AND lng IS NOT NULL
      AND lat BETWEEN -90 AND 90
      AND lng BETWEEN -180 AND 180
    )
  );

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "showExactPhotoLocation" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex (map queries locate photos by their denormalized position)
CREATE INDEX "Media_workspaceId_lat_lng_idx" ON "Media"("workspaceId", "lat", "lng");

-- CreateIndex (the per-trip photo map is the more common filter)
CREATE INDEX "Media_tripId_lat_lng_idx" ON "Media"("tripId", "lat", "lng");
