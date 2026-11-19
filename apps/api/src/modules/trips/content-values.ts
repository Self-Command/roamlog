import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { GeoBboxSchema, PlaceProviderSchema, UuidV7Schema, type GeoBbox, type WorkspaceRole } from "@roamlog/contracts";

import { resolveTripAccess } from "./trip-access.js";

export const UNSPECIFIED_TRIP_ORIGIN = "未填写";

export function canonicalTripOrigin(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : UNSPECIFIED_TRIP_ORIGIN;
}

export function dateOnlyToDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function presentDate(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export function isDateWithin(start: Date, end: Date, value: Date): boolean {
  return value >= start && value <= end;
}

export function assertDateRange(start: Date, end: Date, field = "endDate"): void {
  if (end < start) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "The end date must be on or after the start date.",
      errors: [{ field, code: "INVALID_DATE_RANGE", message: "Invalid date range." }],
    });
  }
}

export function assertDateWithinTrip(
  date: Date,
  tripStart: Date,
  tripEnd: Date,
  field = "date",
): void {
  if (!isDateWithin(tripStart, tripEnd, date)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "The date must fall inside the trip date range.",
      errors: [{ field, code: "OUTSIDE_TRIP_DATES", message: "Date is outside the trip." }],
    });
  }
}

export function assertBudgetPair(
  amountMinor: number | null,
  currency: string | null,
): void {
  if ((amountMinor === null) !== (currency === null)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "budgetAmountMinor and budgetCurrency must be provided together.",
      errors: [
        {
          field: "budgetAmountMinor",
          code: "INVALID_BUDGET",
          message: "Budget amount and currency must be supplied together.",
        },
      ],
    });
  }
}

/**
 * Enforces the paired-origin-coordinate invariant.
 *
 * `originLat`/`originLng` are a single location: both are set or both are `null`.
 * The database enforces the same rule with a CHECK constraint; the API reports a
 * 422 so a well-formed request that breaks the business rule gets a field-scoped
 * error instead of a 500 from the constraint.
 */
export function assertOriginCoordinatePair(
  lat: number | null | undefined,
  lng: number | null | undefined,
  field = "originLng",
): void {
  const hasLat = typeof lat === "number";
  const hasLng = typeof lng === "number";
  if (hasLat === hasLng) {
    return;
  }
  throw new UnprocessableEntityException({
    code: "VALIDATION_ERROR",
    message: "originLat and originLng must be provided together.",
    errors: [
      {
        field,
        code: "INVALID_COORDINATE_PAIR",
        message: "Origin latitude and longitude must both be set or both be null.",
      },
    ],
  });
}

/**
 * Reads `originLat`/`originLng` out of an unvalidated request body.
 *
 * Used before schema parsing so the paired-coordinate rule is reported as 422 for
 * creations too; everything else about the request is still owned by the schema.
 * Returns `null` when the body does not mention either coordinate.
 */
export function rawOriginCoordinatePair(
  rawInput: unknown,
): { lat: number | null; lng: number | null } | null {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    return null;
  }
  const body = rawInput as Record<string, unknown>;
  if (!("originLat" in body) && !("originLng" in body)) {
    return null;
  }
  return { lat: coordinateSlot(body.originLat), lng: coordinateSlot(body.originLng) };
}

function coordinateSlot(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Rejects a bounding box that is not `[west, south, east, north]` inside the
 * WGS84 range.
 *
 * The shape check runs on the raw body before schema parsing so a malformed box
 * is reported as `422 INVALID_BBOX` with the field that caused it, matching the
 * existing coordinate-pair handling. `null` (and an absent value) are accepted:
 * `null` clears a stored box, absence leaves it untouched.
 */
export function assertBbox(value: unknown, field = "bbox"): void {
  if (value === null || value === undefined) {
    return;
  }
  const parsed = GeoBboxSchema.safeParse(value);
  if (parsed.success) {
    return;
  }
  throw new UnprocessableEntityException({
    code: "INVALID_BBOX",
    message: "bbox must be [west, south, east, north] inside the WGS84 range.",
    errors: [
      {
        field,
        code: "INVALID_BBOX",
        message: parsed.error.issues[0]?.message ?? "Invalid bounding box.",
      },
    ],
  });
}

/**
 * Reads one bounding-box field out of an unvalidated request body.
 *
 * Returns `false` when the key is absent (an update must then leave the column
 * untouched) and `true` with the raw value otherwise, so the caller can hand
 * `null` through as an explicit clear.
 */
export function rawBboxField(
  rawInput: unknown,
  field: string,
): { present: boolean; value: unknown } {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    return { present: false, value: null };
  }
  const body = rawInput as Record<string, unknown>;
  return field in body ? { present: true, value: body[field] } : { present: false, value: null };
}

/**
 * Validates the bounding box when the raw body mentions it.
 *
 * Absent keys pass untouched (an update must not clear a stored box), and an
 * explicit `null` is accepted because it clears the column.
 */
export function assertRawBbox(rawInput: unknown, field = "bbox"): void {
  const raw = rawBboxField(rawInput, field);
  if (raw.present) {
    assertBbox(raw.value, field);
  }
}

/**
 * Rejects a `provider` value outside the stored `PlaceProviderSchema`.
 *
 * The enum lives in the contract, but the generic parse mapping reports it as
 * `400`; a place source the contract does not admit is a business-validation
 * failure, so it is checked on the raw body first and reported as
 * `422 INVALID_PROVIDER` for the same reason as `assertBbox`. An absent key
 * passes (an update keeps the stored provider) and `null` is accepted because
 * it clears the source.
 */
export function assertRawProvider(rawInput: unknown, field = "provider"): void {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    return;
  }
  const body = rawInput as Record<string, unknown>;
  if (!(field in body) || body[field] === undefined) {
    return;
  }
  const parsed = PlaceProviderSchema.nullable().safeParse(body[field]);
  if (parsed.success) {
    return;
  }
  throw new UnprocessableEntityException({
    code: "INVALID_PROVIDER",
    message: `provider must be one of ${PlaceProviderSchema.options.join(", ")} or null.`,
    errors: [
      {
        field,
        code: "INVALID_PROVIDER",
        message: parsed.error.issues[0]?.message ?? "Unsupported place provider.",
      },
    ],
  });
}

/**
 * Normalizes a stored `JSONB` value into the contract tuple.
 *
 * A row that does not hold a valid box reports `null` rather than throwing: one
 * malformed column must not turn an entire trip read into a 500. New writes are
 * already schema-checked, so this only guards legacy or out-of-band rows.
 */
export function toBbox(value: unknown): GeoBbox | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = GeoBboxSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function assertUuid(value: string, field: string): void {
  if (!UuidV7Schema.safeParse(value).success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: `${field} must be a UUIDv7.`,
      errors: [{ field, code: "INVALID_INPUT", message: "Expected a UUIDv7." }],
    });
  }
}

/**
 * Access data a caller may have already loaded for a trip.
 *
 * Every field is optional: call sites that only select the trip's visibility
 * columns keep working, and a call without `grants` simply cannot match a
 * `custom` grant (fail closed — the trip stays invisible rather than leaking).
 * Nothing here queries the database; see `trip-access.ts` for the rule itself.
 */
export interface TripAccessContext {
  platformRole?: string;
  /** The actor's own participant row; `null` means "has none". */
  participation?: { status: string } | null;
  grants?: ReadonlyArray<{ workspaceId: string | null; userId: string | null }>;
}

/**
 * The trip fields the visibility decision needs, plus the relations when the
 * caller loaded them. `participants` / `accessGrants` are read only for the
 * requesting actor, so an unfiltered include is not a leak (the decision still
 * keys on `membership.userId`).
 */
export interface TripVisibilityRecord {
  /** Unused by the decision; kept so callers can pass a full Prisma row. */
  id?: string;
  workspaceId: string;
  visibility: string;
  createdById: string;
  participants?: ReadonlyArray<{ userId: string; status?: string | null }> | null;
  accessGrants?: ReadonlyArray<{ workspaceId: string | null; userId: string | null }> | null;
}

/**
 * Asserts that the actor may read the trip, throwing the same 404 every content
 * module already produced.
 *
 * This used to be its own rule (`private` + not creator + workspace
 * owner/admin). It now delegates to `resolveTripAccess`, so the function, the
 * media `where` filter and the trip list agree by construction:
 *
 *   - `custom` is readable only by the creator, a matching grant, a participant
 *     or a super admin;
 *   - `private` is readable by the creator and invited/joined participants — a
 *     workspace `owner`/`admin` no longer bypasses it;
 *   - `workspace` and `public_link` stay readable by every workspace member,
 *     preserving the list/detail agreement those tiers already had.
 *
 * The function is synchronous and side-effect free by design: the grants and
 * participant row are injected by the caller (`TripsService` loads both for the
 * single-trip read paths) so a request never turns into a per-trip query.
 */
export function assertTripVisible(
  membership: { role: WorkspaceRole; userId: string; workspaceId?: string },
  trip: TripVisibilityRecord,
  context: TripAccessContext = {},
): void {
  const participation =
    context.participation !== undefined
      ? context.participation
      : (trip.participants?.find((participant) => participant.userId === membership.userId) ?? null);
  const grants = context.grants ?? trip.accessGrants ?? [];

  const allowed = resolveTripAccess({
    actor: {
      userId: membership.userId,
      // Callers resolve the membership before loading the trip, and every trip
      // read is workspace-scoped, so an omitted workspaceId can only mean "the
      // trip's workspace" — the actor's own.
      workspaceId: membership.workspaceId ?? trip.workspaceId,
      platformRole: context.platformRole ?? "user",
    },
    trip: {
      id: trip.id ?? "",
      workspaceId: trip.workspaceId,
      createdById: trip.createdById,
      visibility: trip.visibility,
    },
    participation: participation === null ? null : { status: participation.status ?? "joined" },
    grants,
  });

  if (!allowed) {
    throw new NotFoundException({
      code: "TRIP_NOT_FOUND",
      message: "The requested trip was not found.",
    });
  }
}

export function sortParts(
  sort: string | undefined,
  allowed: readonly string[],
  fallbackField: string,
): { field: string; direction: "asc" | "desc" } {
  if (!sort) {
    return { field: fallbackField, direction: "desc" };
  }
  const [field, direction] = sort.split(":");
  if (!field || !allowed.includes(field) || (direction !== "asc" && direction !== "desc")) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Unsupported sort expression.",
      errors: [{ field: "sort", code: "INVALID_SORT", message: "Unsupported sort." }],
    });
  }
  return { field, direction };
}
