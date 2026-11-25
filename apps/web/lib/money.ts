/**
 * Currency helpers for values stored as ISO 4217 minor units.
 *
 * The API contract stores `amountMinor`; currencies do not all use two
 * fractional digits. `Intl.NumberFormat` is the source of truth for the
 * currency's minor-unit exponent so CNY (2), JPY (0), USD (2), and the other
 * supported currencies round-trip without a 100x display/edit error.
 */

const DEFAULT_FRACTION_DIGITS = 2;

export function currencyFractionDigits(currency: string): number {
  try {
    const resolved = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions();
    return resolved.maximumFractionDigits ?? DEFAULT_FRACTION_DIGITS;
  } catch {
    return DEFAULT_FRACTION_DIGITS;
  }
}

export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyFractionDigits(currency);
}

export function majorToMinor(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyFractionDigits(currency));
}

export function formatCurrencyMinor(
  amountMinor: number,
  currency: string,
  locale = "zh-CN",
): string {
  const digits = currencyFractionDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minorToMajor(amountMinor, currency));
  } catch {
    return `${String(minorToMajor(amountMinor, currency))} ${currency}`;
  }
}
