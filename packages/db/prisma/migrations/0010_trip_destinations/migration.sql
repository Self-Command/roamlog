-- Structured trip destinations (0010).
--
-- Until now `Trip.destinations` was a `text[]` of names: enough to render a
-- route label, not enough to put a pin on a map or to echo the picked place
-- back into the edit form. This migration adds one row per destination with the
-- place metadata the API already accepts for an origin (`provider`,
-- `providerPlaceId`, `address`, `country`, `countryCode`, `lat`, `lng`,
-- `timeZone`, `bbox`, `order`).
--
-- Additive only, with one intentional exception: the existing names are
-- **copied** into rows by the INSERT ... SELECT below. No column is dropped,
-- retyped or rewritten, and `Trip.destinations` stays in place (marked
-- deprecated with a column comment) for a deprecation window so every reader
-- that only knows the string array keeps working.

-- CreateTable
CREATE TABLE "TripDestination" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "provider" TEXT,
    "providerPlaceId" TEXT,
    "address" VARCHAR(400),
    "country" TEXT,
    "countryCode" VARCHAR(2),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "timeZone" TEXT,
    "bbox" JSONB,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "TripDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripDestination_tripId_order_idx" ON "TripDestination"("tripId", "order");

-- Order is unique *among active rows only*.
--
-- A plain `UNIQUE ("tripId", "order")` cannot coexist with soft deletion: the
-- API replaces the whole group by soft-deleting the old rows and inserting the
-- new ones at the same positions, so the deleted row would block its own
-- replacement. The partial index keeps "one active destination per position"
-- as a database invariant while letting history accumulate. Prisma cannot
-- express partial indexes, so this index exists only here (same pattern as
-- `WorkspaceMember_one_owner_per_workspace` in 0001).
CREATE UNIQUE INDEX "TripDestination_tripId_order_active_key"
  ON "TripDestination"("tripId", "order")
  WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "TripDestination_tripId_deletedAt_idx"
  ON "TripDestination"("tripId", "deletedAt");

-- ForeignKey
ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_tripId_fkey"
FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allow-lists and shape invariants. Every value the API can write is accepted;
-- an out-of-band writer is rejected instead of storing a location the readers
-- cannot interpret.
ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_provider_check"
  CHECK ("provider" IS NULL OR "provider" IN ('geoapify', 'photon', 'local'));

ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_country_code_check"
  CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$');

ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_lat_range_check"
  CHECK ("lat" IS NULL OR "lat" BETWEEN -90 AND 90);

ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_lng_range_check"
  CHECK ("lng" IS NULL OR "lng" BETWEEN -180 AND 180);

-- A single coordinate is not a place: either both halves are present or neither
-- is. `countryCode` is CHAR-free (`VARCHAR(2)`), so no padding can sneak in.
ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_coords_pair_check"
  CHECK (("lat" IS NULL) = ("lng" IS NULL));

ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_order_nonnegative_check"
  CHECK ("order" >= 0);

-- Same envelope contract as `Stop_bbox_shape_check`: a 4-number JSON array in
-- `[west, south, east, north]` order. `jsonb_array_length` raises on a non-array,
-- so `jsonb_typeof` must come first inside the same boolean expression.
ALTER TABLE "TripDestination"
ADD CONSTRAINT "TripDestination_bbox_shape_check"
  CHECK (
    "bbox" IS NULL OR (
      jsonb_typeof("bbox") = 'array'
      AND jsonb_array_length("bbox") = 4
      AND jsonb_typeof("bbox" -> 0) = 'number'
      AND jsonb_typeof("bbox" -> 1) = 'number'
      AND jsonb_typeof("bbox" -> 2) = 'number'
      AND jsonb_typeof("bbox" -> 3) = 'number'
    )
  );

-- Deprecation marker for the names-only column; readers must prefer
-- `destinationsV2`. Postgres comments are not modelled by Prisma, so this stays
-- migration-only documentation.
COMMENT ON COLUMN "Trip"."destinations" IS
  'DEPRECATED since 0010_trip_destinations: names-only mirror. Structured place metadata lives in "TripDestination"; read paths prefer it and derive this array from its active rows.';

-- ---------------------------------------------------------------------------
-- Backfill: one row per existing destination string, preserving order.
-- ---------------------------------------------------------------------------
--
-- Prisma maps `String[]` to `TEXT[]` (0001), so the set-based reader is
-- `unnest(...) WITH ORDINALITY` rather than `jsonb_array_elements_text` (which
-- only accepts `jsonb`). Rows keep `provider` NULL: the legacy array never
-- recorded where a name came from, and inventing `local`/`photon` for it would
-- be a lie the UI then displays.
--
-- IDs are UUIDv7-shaped but deterministic (`md5(tripId:ordinality)` with the
-- version/variant nibbles forced), because PostgreSQL 17 has no `uuidv7()` and
-- the contract validates the version: a random v4 id would make the migrated
-- rows unreadable by `TripDestinationSchema`.
INSERT INTO "TripDestination" ("id", "tripId", "name", "provider", "order", "createdAt")
SELECT
  (
    substr(source."digest", 1, 8) || '-' ||
    substr(source."digest", 9, 4) || '-' ||
    '7' || substr(source."digest", 14, 3) || '-' ||
    '8' || substr(source."digest", 18, 3) || '-' ||
    substr(source."digest", 21, 12)
  )::uuid,
  source."tripId",
  source."name",
  NULL,
  source."ordinality" - 1,
  now()
FROM (
  SELECT
    trip."id" AS "tripId",
    btrim(destination."value") AS "name",
    destination."ordinality",
    md5(trip."id"::text || ':' || destination."ordinality"::text) AS "digest"
  FROM "Trip" AS trip
  CROSS JOIN LATERAL unnest(trip."destinations")
    WITH ORDINALITY AS destination("value", "ordinality")
) AS source
WHERE source."name" <> '';