/**
 * Date-only helpers for the trip form.
 *
 * Every trip date is a `YYYY-MM-DD` calendar date (see `DateOnlySchema`). These
 * helpers deliberately work on UTC timestamps so a timezone shift can never move
 * a trip one day, and they never depend on `Intl` so the calendar grid renders
 * the same in Node, jsdom and the browser.
 */

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toDateOnly(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function parseDateOnly(value: string): DateParts | null {
  const match = DATE_ONLY_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidDateOnly(value: string): boolean {
  return parseDateOnly(value) !== null;
}

/** The visitor's local calendar date, not the UTC date. */
export function todayDateOnly(now: Date = new Date()): string {
  return toDateOnly({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

function timestamp(parts: DateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function compareDateOnly(left: string, right: string): number {
  return timestamp(parseDateOnlyOrThrow(left)) - timestamp(parseDateOnlyOrThrow(right));
}

function parseDateOnlyOrThrow(value: string): DateParts {
  const parts = parseDateOnly(value);
  if (!parts) throw new RangeError(`"${value}" is not a YYYY-MM-DD calendar date.`);
  return parts;
}

export function addDays(value: string, days: number): string {
  const parts = parseDateOnlyOrThrow(value);
  const next = new Date(timestamp(parts) + days * MILLISECONDS_PER_DAY);
  return toDateOnly({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = month - 1 + delta;
  const nextYear = year + Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12;
  return { year: nextYear, month: nextMonth + 1 };
}

/**
 * Weeks for a Monday-first month grid. Padding cells are `null` so the caller
 * can render non-interactive placeholders without inventing dates.
 */
export function buildMonthWeeks(year: number, month: number): Array<Array<string | null>> {
  const total = daysInMonth(year, month);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  // Monday-first: Sunday (0) becomes the 7th column.
  const leading = (firstWeekday + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push(toDateOnly({ year, month, day }));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export function isDateOutsideRange(value: string, min?: string, max?: string): boolean {
  if (min && value < min) return true;
  if (max && value > max) return true;
  return false;
}

export function clampDateOnly(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

export function formatDateOnlyLabel(value: string): string {
  const parts = parseDateOnly(value);
  if (!parts) return value;
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${year}年${month}月`;
}

export function formatDateRangeLabel(startDate: string, endDate: string): string {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return "";
  if (start.year === end.year) {
    return `${start.year}年${start.month}月${start.day}日 – ${end.month}月${end.day}日`;
  }
  return `${formatDateOnlyLabel(startDate)} – ${formatDateOnlyLabel(endDate)}`;
}

/** Inclusive day count, matching `Trip.durationDays` in the contract. */
export function inclusiveDurationDays(startDate: string, endDate: string): number | null {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return null;
  const difference = Math.round((timestamp(end) - timestamp(start)) / MILLISECONDS_PER_DAY);
  return difference < 0 ? null : difference + 1;
}
