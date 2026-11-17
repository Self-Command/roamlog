import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UuidV7Schema, type WorkspaceRole } from "@roamlog/contracts";

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

export function assertUuid(value: string, field: string): void {
  if (!UuidV7Schema.safeParse(value).success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: `${field} must be a UUIDv7.`,
      errors: [{ field, code: "INVALID_INPUT", message: "Expected a UUIDv7." }],
    });
  }
}

export function assertTripVisible(
  membership: { role: WorkspaceRole; userId: string },
  trip: { visibility: string; createdById: string },
): void {
  if (
    trip.visibility === "private" &&
    trip.createdById !== membership.userId &&
    membership.role !== "owner" &&
    membership.role !== "admin"
  ) {
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
