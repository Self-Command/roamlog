-- Trip and Stop place context that used to live only in the browser.
--
-- The place search already returns a formatted `address` and a bounding box;
-- before this migration both were dropped on save, so a selected origin lost
-- its address on the next refresh. These columns persist them.
--
-- Additive only: no new table, no primary-key change, no column type change, no
-- data rewrite, and no NOT NULL column. Every new column is nullable and has no
-- default, so this migration applies to an empty database and to a populated
-- one with identical results: existing rows keep NULL for every new column.

-- AlterTable
ALTER TABLE "Trip"
ADD COLUMN "originAddress" VARCHAR(400),
ADD COLUMN "originBbox" JSONB;

-- AlterTable
ALTER TABLE "Stop"
ADD COLUMN "address" VARCHAR(400),
ADD COLUMN "bbox" JSONB;

-- Both columns hold the same value: a GeoJSON-style envelope ordered
-- [west, south, east, north]. `jsonb_array_length` raises on a non-array, so the
-- `jsonb_typeof` guard has to come first inside the same boolean expression.
-- Postgres cannot store NaN/Infinity as JSON numbers (the jsonb parser rejects
-- them), so a per-element `number` check is enough to exclude non-finite values.
ALTER TABLE "Stop"
ADD CONSTRAINT "Stop_bbox_shape_check"
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

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_bbox_shape_check"
CHECK (
    "originBbox" IS NULL OR (
        jsonb_typeof("originBbox") = 'array'
        AND jsonb_array_length("originBbox") = 4
        AND jsonb_typeof("originBbox" -> 0) = 'number'
        AND jsonb_typeof("originBbox" -> 1) = 'number'
        AND jsonb_typeof("originBbox" -> 2) = 'number'
        AND jsonb_typeof("originBbox" -> 3) = 'number'
    )
);