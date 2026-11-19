/**
 * The single trip-access rule.
 *
 * The implementation now lives in `@roamlog/db` (`packages/db/src/
 * trip-access.ts`) so the BullMQ worker can import the *same* predicate:
 * `apps/worker/src/jobs/{export,reminders}.ts` enumerate trips and resolve
 * recipients, and they must answer "may this person read this trip?" with the
 * identical rule the API uses. The worker build pins `rootDir: "src"`, so it
 * cannot reach into `apps/api` — the shared package is the only place both
 * sides can import from.
 *
 * This module stays as the API-facing entry point: nothing under `apps/api`
 * changes its import path, so the seven `resolveTripAccess` callers, the
 * thirty-one `assertTripVisible` callers and the ten `tripVisibilityWhere`
 * callers keep working, and `visibility-parity.spec.ts` continues to pin the
 * function against the SQL filter.
 *
 * Read the rule's ordering documentation in the implementation module: steps
 * are evaluated in order and the first match wins (`super_admin` → creator →
 * workspace member on a workspace-shared tier → participant → `custom` grant →
 * deny).
 */

export {
  PARTICIPANT_ACCESS_STATUSES,
  WORKSPACE_SHARED_VISIBILITIES,
  explainTripAccess,
  resolveTripAccess,
  tripVisibilityWhere,
} from "@roamlog/db";
export type {
  TripAccessActor,
  TripAccessExplanation,
  TripAccessInput,
  TripAccessReason,
} from "@roamlog/db";
