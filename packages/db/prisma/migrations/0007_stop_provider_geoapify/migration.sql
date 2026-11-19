-- Allow a stop selected from a Geoapify search result to be stored verbatim.
--
-- The place search has returned Geoapify results since the places provider
-- landed (Photon is the keyless fallback), but `Stop_provider_check` only
-- allowed `photon`/`local`, so picking a Geoapify place failed at insert time
-- with SQLSTATE 23514. The contract enum (`PlaceProviderSchema`) is widened in
-- the same change, so this is the database half of one functional fix.
--
-- Constraint-only: no column is added, dropped or altered, and no row is
-- rewritten. Every existing row already satisfies the widened allow-list
-- because the previous constraint only admitted two of the three values.

-- AlterTable
ALTER TABLE "Stop" DROP CONSTRAINT "Stop_provider_check";

-- AlterTable
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_provider_check"
  CHECK ("provider" IS NULL OR "provider" IN ('geoapify', 'photon', 'local'));