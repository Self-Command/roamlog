/**
 * Date rules for the AI planner.
 *
 * The model is told today's date, but prompt-only obedience is not a guarantee:
 * the plan phase validates every date argument it is about to queue and refuses
 * calls whose dates are in the past. Comparison happens on `YYYY-MM-DD` strings
 * inside a single timezone, so no offset arithmetic can shift a day.
 */

/** Tools whose arguments carry a plan date, and the fields to inspect. */
export const AI_DATE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "trips.create": ["startDate", "endDate"],
  "stops.add": ["startDate", "endDate"],
  "itinerary.addDay": ["date"],
});

/** One day of tolerance so "today" in the user's zone cannot reject a valid day. */
export const PAST_DATE_TOLERANCE_DAYS = 1;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;

/** The host's IANA zone; the same value the prompt shows to the model. */
export function resolveAiTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** `2026-11-19` as seen in `timeZone`, never `toISOString()` (which is UTC). */
export function formatDateOnly(now: Date, timeZone: string = resolveAiTimeZone()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day"): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Calendar arithmetic on date-only strings (UTC noon avoids DST edges). */
export function shiftDateOnly(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export interface PastDateIssue {
  readonly field: string;
  readonly value: string;
  /** The earliest date the runtime accepts, `today - tolerance`. */
  readonly earliest: string;
}

/**
 * Returns the first date field that is earlier than `today - tolerance`.
 *
 * Values with another shape (for example `2020/04/05`) are left for the zod
 * argument schema, which already rejects them as `INVALID_ARGUMENTS`.
 */
export function findPastDateIssue(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  today: string,
  toleranceDays: number = PAST_DATE_TOLERANCE_DAYS,
): PastDateIssue | null {
  const fields = AI_DATE_FIELDS[tool];
  if (!fields) {
    return null;
  }
  const earliest = shiftDateOnly(today, -toleranceDays);
  for (const field of fields) {
    const value = args[field];
    if (typeof value !== "string" || !DATE_ONLY.test(value)) {
      continue;
    }
    if (value < earliest) {
      return { field, value, earliest };
    }
  }
  return null;
}

/** Human-readable reason for the tool-result feedback and the response warning. */
export function pastDateFeedback(issue: PastDateIssue, today: string): string {
  return (
    `${issue.field} ${issue.value} is earlier than today (${today}). ` +
    `Every date must be on or after ${today}; if the user did not name a year, ` +
    "use the nearest future dates. Do not repeat this call with the same date."
  );
}