/**
 * Expected numbers for mock-mode specs.
 *
 * The web e2e suite runs against the MSW fixtures (`@roamlog/api-mocks`), so
 * expectations about counts must be derived from the same fixture module the
 * app is served from. Hard-coding them ("9", "SHOWING 9 OF 9") makes a spec go
 * stale every time the demo dataset changes, which is exactly the class of
 * drift this file removes.
 *
 * Imported through a relative path because `@roamlog/api-mocks` is only a
 * dependency of `apps/web`, not of the workspace root that Playwright runs from.
 */
import { demoTrips } from "../../packages/api-mocks/src/fixtures";

export const MOCK_TRIP_COUNT = demoTrips.length;

export const MOCK_TRIP_COUNT_BY_STATUS = demoTrips.reduce<Record<string, number>>(
  (counts, trip) => {
    counts[trip.status] = (counts[trip.status] ?? 0) + 1;
    return counts;
  },
  {},
);