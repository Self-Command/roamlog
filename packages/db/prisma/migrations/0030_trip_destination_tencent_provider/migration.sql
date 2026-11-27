-- Align the stored destination provider allow-list with the public contract.
--
-- `TripDestinationProviderSchema` has accepted Tencent and map-pin results
-- since the provider registry shipped, but the 0010 constraint still only
-- admitted the original three providers. Saving a real Tencent result failed
-- at the database boundary with SQLSTATE 23514.
--
-- Constraint-only: every existing row satisfies the widened allow-list.

ALTER TABLE "TripDestination" DROP CONSTRAINT "TripDestination_provider_check";

ALTER TABLE "TripDestination" ADD CONSTRAINT "TripDestination_provider_check"
  CHECK ("provider" IS NULL OR "provider" IN ('geoapify', 'photon', 'tencent', 'local', 'map_pin'));
