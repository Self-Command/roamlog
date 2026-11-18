/**
 * Currency options for the budget field.
 *
 * ISO 4217 codes come from the runtime (`Intl.supportedValuesOf`) and fall back
 * to a curated list when the environment is old. Display names are optional: the
 * combobox still searches by code when `Intl.DisplayNames` is unavailable.
 */

export interface CurrencyOption {
  code: string;
  name: string;
}

const FALLBACK_CODES = [
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "TWD",
  "SGD",
  "THB",
  "KRW",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "MYR",
  "VND",
  "PHP",
  "IDR",
  "AED",
  "INR",
  "BRL",
  "MXN",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "TRY",
  "ZAR",
] as const;

const PRIORITY_CODES = [
  "CNY",
  "USD",
  "EUR",
  "JPY",
  "GBP",
  "HKD",
  "TWD",
  "SGD",
  "THB",
  "KRW",
] as const;

let cachedOptions: CurrencyOption[] | null = null;

function supportedCurrencyCodes(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const values = intl.supportedValuesOf?.("currency");
    if (Array.isArray(values) && values.length > 0) return values;
  } catch {
    // Older runtimes throw for unsupported keys; fall through to the list.
  }
  return [...FALLBACK_CODES];
}

function currencyDisplayNames(): Intl.DisplayNames | null {
  try {
    if (typeof Intl.DisplayNames !== "function") return null;
    return new Intl.DisplayNames(["zh-CN"], { type: "currency" });
  } catch {
    return null;
  }
}

export function getCurrencyOptions(): CurrencyOption[] {
  if (cachedOptions) return cachedOptions;
  const display = currencyDisplayNames();
  const priority = new Set<string>(PRIORITY_CODES);
  const codes = supportedCurrencyCodes();
  const options = codes.map((code) => {
    let name: string;
    try {
      name = display?.of(code) ?? code;
    } catch {
      name = code;
    }
    return { code, name: name === code ? code : `${name} · ${code}` };
  });
  options.sort((left, right) => {
    const leftPriority = priority.has(left.code) ? PRIORITY_CODES.indexOf(left.code as never) : 99;
    const rightPriority = priority.has(right.code)
      ? PRIORITY_CODES.indexOf(right.code as never)
      : 99;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.code.localeCompare(right.code);
  });
  cachedOptions = options;
  return options;
}

export function findCurrency(code: string): CurrencyOption | undefined {
  return getCurrencyOptions().find((option) => option.code === code);
}

export function searchCurrencies(query: string, limit = 8): CurrencyOption[] {
  const options = getCurrencyOptions();
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options.slice(0, limit);
  const matches = options.filter(
    (option) =>
      option.code.toLowerCase().includes(normalized) ||
      option.name.toLowerCase().includes(normalized),
  );
  return matches.slice(0, limit);
}
