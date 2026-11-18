-- Wave 0: place context and budget invariants.
--
-- Additive only: no new table, no primary-key change, no column type change, no
-- data rewrite, and no NOT NULL column. Every new column is nullable and has no
-- default, so this migration applies to an empty database and to a populated
-- one with identical results: existing rows keep NULL for every new column.

-- AlterTable
ALTER TABLE "Trip"
ADD COLUMN "originLat" DOUBLE PRECISION,
ADD COLUMN "originLng" DOUBLE PRECISION,
ADD COLUMN "originCountryCode" CHAR(2),
ADD COLUMN "timeZone" TEXT;

-- AlterTable
ALTER TABLE "Stop"
ADD COLUMN "provider" TEXT,
ADD COLUMN "providerPlaceId" TEXT,
ADD COLUMN "timeZone" TEXT;

-- Trip origin: a half coordinate pair is meaningless, so latitude and longitude
-- are either both absent or both present and inside the WGS84 range.
ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_coords_pair_check"
CHECK (("originLat" IS NULL) = ("originLng" IS NULL));

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_lat_range_check"
CHECK ("originLat" IS NULL OR "originLat" BETWEEN -90 AND 90);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_origin_lng_range_check"
CHECK ("originLng" IS NULL OR "originLng" BETWEEN -180 AND 180);

-- Trip budget: minor units are never negative, and amount and currency travel
-- together so a total without a currency (or the reverse) is rejected.
ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_budget_amount_nonnegative_check"
CHECK ("budgetAmountMinor" IS NULL OR "budgetAmountMinor" >= 0);

ALTER TABLE "Trip"
ADD CONSTRAINT "Trip_budget_pair_check"
CHECK (("budgetAmountMinor" IS NULL) = ("budgetCurrency" IS NULL));

-- Stop place identity: only the providers the app can resolve are accepted.
ALTER TABLE "Stop"
ADD CONSTRAINT "Stop_provider_check"
CHECK ("provider" IS NULL OR "provider" IN ('photon', 'local'));
