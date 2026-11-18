import type { CurrencyTotal } from "@roamlog/contracts";

/**
 * Money rendering for the trip workspace.
 *
 * The API stores integer minor units (`AmountMinorSchema`). The number of
 * fraction digits is a property of the ISO 4217 currency, not a constant: CNY
 * has 2, JPY has 0. `Intl` knows that table, so the digits are resolved from it
 * instead of hardcoding `/ 100`.
 *
 * No currency is ever converted here — multi-currency totals stay per currency.
 */
const fractionDigitsCache = new Map<string, number>();

function fractionDigits(currency: string): number {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;

  let digits: number;
  try {
    const resolved = new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
    }).resolvedOptions();
    digits = resolved.maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
}

export function formatMinor(amountMinor: number, currency: string): string {
  if (!Number.isFinite(amountMinor)) return "—";
  const digits = fractionDigits(currency);
  const major = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

export interface CurrencySum {
  currency: string;
  amountMinor: number;
  count: number;
}

/** Sum real amounts per currency. Never merges or converts currencies. */
export function sumByCurrency(
  entries: ReadonlyArray<{ amountMinor: number; currency: string }>,
): CurrencySum[] {
  const totals = new Map<string, CurrencySum>();
  for (const entry of entries) {
    const current = totals.get(entry.currency);
    if (current) {
      current.amountMinor += entry.amountMinor;
      current.count += 1;
      continue;
    }
    totals.set(entry.currency, {
      currency: entry.currency,
      amountMinor: entry.amountMinor,
      count: 1,
    });
  }

  return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

/** Shape the budget summary's exact per-currency totals into the same view model. */
export function currencyTotalsToSums(totals: ReadonlyArray<CurrencyTotal>): CurrencySum[] {
  return [...totals]
    .map((total) => ({ currency: total.currency, amountMinor: total.amountMinor, count: 0 }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function remainingMinor(budgetMinor: number, spentMinor: number): number {
  return budgetMinor - spentMinor;
}

/**
 * Parses a major-unit input (`12.34`) into integer minor units for the given
 * currency, rounding to the currency's own precision. Returns `null` for
 * anything that is not a non-negative decimal, so the form can show a real
 * error instead of sending `NaN`.
 */
export function parseAmountToMinor(input: string, currency: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  const digits = fractionDigits(currency);
  return Math.round(value * 10 ** digits);
}

/** Inverse of `parseAmountToMinor`, for editing an existing amount. */
export function minorToInputValue(amountMinor: number, currency: string): string {
  const digits = fractionDigits(currency);
  if (digits === 0) return String(amountMinor);
  return (amountMinor / 10 ** digits).toFixed(digits);
}

export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}