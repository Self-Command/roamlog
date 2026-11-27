-- Preserve the uploader-facing basename as metadata. Object keys remain
-- generated opaque paths; legacy rows stay null and readers fall back to the
-- final key segment.
ALTER TABLE "Media"
ADD COLUMN "originalFileName" VARCHAR(255);
