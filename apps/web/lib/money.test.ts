import { describe, expect, it } from "vitest";

import {
  currencyFractionDigits,
  formatCurrencyMinor,
  majorToMinor,
  minorToMajor,
} from "./money";

describe("currency minor units", () => {
  it("uses the ISO currency exponent instead of assuming two decimals", () => {
    expect(currencyFractionDigits("CNY")).toBe(2);
    expect(currencyFractionDigits("USD")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KRW")).toBe(0);
  });

  it("round-trips CNY and JPY amounts without a 100x error", () => {
    expect(majorToMinor(8000, "CNY")).toBe(800_000);
    expect(minorToMajor(800_000, "CNY")).toBe(8000);
    expect(majorToMinor(200_000, "JPY")).toBe(200_000);
    expect(minorToMajor(200_000, "JPY")).toBe(200_000);
  });

  it("formats JPY without false fractional digits", () => {
    const formatted = formatCurrencyMinor(200_000, "JPY", "en-US");
    expect(formatted).toContain("200,000");
    expect(formatted).not.toContain("2,000.00");
    expect(formatted).not.toContain("2,000");
  });
});
