-- Allow the two new search providers to be stored on a stop.
--
-- `PlaceSearchProviderSchema` gained `tencent` (mainland-China results,
-- normalized from GCJ-02 to WGS-84) and `map_pin` (the local "pick on the map"
-- fallback). The stored enum (`PlaceProviderSchema`) was widened in the same
-- change, but `Stop_provider_check` still allowed only
-- `geoapify`/`photon`/`local`, so a Tencent result or a map-picked point would
-- fail at insert time with SQLSTATE 23514 — the same class of bug 0007 fixed
-- for Geoapify.
--
-- Constraint-only: no column is added, dropped or altered, and no row is
-- rewritten. Every existing row already satisfies the widened allow-list
-- because the previous constraint admitted a subset of it.

-- AlterTable
ALTER TABLE "Stop" DROP CONSTRAINT "Stop_provider_check";

-- AlterTable
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_provider_check"
  CHECK ("provider" IS NULL OR "provider" IN ('geoapify', 'photon', 'tencent', 'local', 'map_pin'));
