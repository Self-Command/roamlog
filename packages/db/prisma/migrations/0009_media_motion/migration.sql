-- Live Photo / Motion Photo: the paired video beside an existing still.
--
-- Additive only. One new table, one new foreign key, no column, type, row or
-- constraint of the existing schema is touched, so a database that already
-- holds 0008 data migrates unchanged and every existing `Media` row simply has
-- no motion sibling (its `livePhoto` projection stays `false`).
--
-- The 1:1 cardinality is enforced by `MediaMotion_mediaId_key`, and the row
-- follows the still's lifecycle through `ON DELETE CASCADE`. The API soft
-- deletes both rows together; the cascade only covers a hard purge.

-- CreateTable
CREATE TABLE "MediaMotion" (
    "id" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MediaMotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (the 1:1: at most one motion row per still)
CREATE UNIQUE INDEX "MediaMotion_mediaId_key" ON "MediaMotion"("mediaId");

-- AddForeignKey
ALTER TABLE "MediaMotion" ADD CONSTRAINT "MediaMotion_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allow-lists and ranges. The API validates the same values through Zod, but
-- the database has to reject nonsense too: a zero-byte or negative-size motion
-- row would make every downstream reader sign a URL to nothing, and a
-- non-video mime type would break the `<video>` element.
ALTER TABLE "MediaMotion" ADD CONSTRAINT "MediaMotion_sizeBytes_check"
  CHECK ("sizeBytes" > 0);

ALTER TABLE "MediaMotion" ADD CONSTRAINT "MediaMotion_durationMs_check"
  CHECK ("durationMs" IS NULL OR "durationMs" >= 0);

ALTER TABLE "MediaMotion" ADD CONSTRAINT "MediaMotion_mimeType_check"
  CHECK ("mimeType" IN ('video/quicktime', 'video/mp4'));

ALTER TABLE "MediaMotion" ADD CONSTRAINT "MediaMotion_dimensions_check"
  CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0));

ALTER TABLE "MediaMotion" ADD CONSTRAINT "MediaMotion_storageKey_check"
  CHECK (length("storageKey") BETWEEN 1 AND 1024);