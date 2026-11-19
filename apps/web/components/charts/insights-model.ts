import type { ExpenseCategory, ExpenseWithSplits, JournalEntry, Trip } from "@roamlog/contracts";

export const categoryLabels: Record<ExpenseCategory, string> = {
  transport: "交通",
  stay: "住宿",
  food: "餐饮",
  activity: "活动",
  shopping: "购物",
  other: "其他",
};

export const categoryColors: Record<ExpenseCategory, string> = {
  transport: "bg-accent-blue",
  stay: "bg-accent-orange",
  food: "bg-accent-yellow",
  activity: "bg-accent-green",
  shopping: "bg-accent-red",
  other: "bg-accent-slate",
};

/**
 * SVG-safe counterpart of `categoryColors`: Recharts paints `fill`/`stroke`
 * attributes, so the chart needs the raw CSS variable instead of the Tailwind
 * utility class. Mapping order is identical to `categoryColors`.
 */
export const categoryChartColors: Record<ExpenseCategory, string> = {
  transport: "var(--accent-blue)",
  stay: "var(--accent-orange)",
  food: "var(--accent-yellow)",
  activity: "var(--accent-green)",
  shopping: "var(--accent-red)",
  other: "var(--accent-slate)",
};

export interface CurrencyTotal {
  currency: string;
  amountMinor: number;
}

export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function countryName(code: string | undefined): string {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function totalByCurrency(
  items: ReadonlyArray<{ amountMinor: number; currency: string }>,
): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amountMinor);
  }
  return [...totals.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((left, right) => right.amountMinor - left.amountMinor);
}

export function aggregateTripStats(trips: Trip[]): {
  tripCount: number;
  totalDays: number;
  countries: number;
  cities: number;
  years: string[];
} {
  const countryCodes = new Set<string>();
  const cities = new Set<string>();
  let totalDays = 0;

  for (const trip of trips) {
    totalDays += trip.durationDays;
    trip.countryCodes.forEach((code) => countryCodes.add(code));
    trip.destinations.forEach((destination) => cities.add(destination));
  }

  return {
    tripCount: trips.length,
    totalDays,
    countries: countryCodes.size,
    cities: cities.size,
    years: [...new Set(trips.map((trip) => trip.startDate.slice(0, 4)))].sort(),
  };
}

export function annualTrips(trips: Trip[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const trip of trips) {
    const year = trip.startDate.slice(0, 4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export interface MonthlySpendPoint {
  key: string;
  label: string;
  amountMinor: number;
}

export function monthlySpend(
  expenses: ExpenseWithSplits[],
  currency: string,
  now = new Date(),
): MonthlySpendPoint[] {
  const points: MonthlySpendPoint[] = [];
  const base = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const amountMinor = expenses
      .filter((expense) => expense.currency === currency && expense.date.startsWith(key))
      .reduce((sum, expense) => sum + expense.amountMinor, 0);
    points.push({
      key,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}月`,
      amountMinor,
    });
  }

  return points;
}

export function categoryTotals(
  expenses: ExpenseWithSplits[],
  currency: string,
): Array<{ category: ExpenseCategory; total: number }> {
  return (Object.keys(categoryLabels) as ExpenseCategory[])
    .map((category) => ({
      category,
      total: expenses
        .filter((expense) => expense.currency === currency && expense.category === category)
        .reduce((sum, expense) => sum + expense.amountMinor, 0),
    }))
    .filter((item) => item.total > 0)
    .sort((left, right) => right.total - left.total);
}

export interface BudgetRow {
  trip: Trip;
  currency: string;
  budgetAmountMinor: number;
  spentAmountMinor: number;
  hasOtherCurrencySpend: boolean;
}

export function budgetRows(trips: Trip[], expenses: ExpenseWithSplits[]): BudgetRow[] {
  return trips
    .filter(
      (trip): trip is Trip & { budgetAmountMinor: number; budgetCurrency: string } =>
        trip.budgetAmountMinor !== null && trip.budgetCurrency !== null,
    )
    .map((trip) => ({
      trip,
      currency: trip.budgetCurrency,
      budgetAmountMinor: trip.budgetAmountMinor,
      spentAmountMinor: expenses
        .filter(
          (expense) =>
            expense.tripId === trip.id && expense.currency === trip.budgetCurrency,
        )
        .reduce((sum, expense) => sum + expense.amountMinor, 0),
      hasOtherCurrencySpend: expenses.some(
        (expense) => expense.tripId === trip.id && expense.currency !== trip.budgetCurrency,
      ),
    }))
    .sort((left, right) => right.budgetAmountMinor - left.budgetAmountMinor)
    .slice(0, 6);
}

export interface HeatmapRow {
  year: string;
  months: Array<{ key: string; count: number }>;
}

export function heatmapRows(entries: JournalEntry[], expenses: ExpenseWithSplits[]): HeatmapRow[] {
  const years = [
    ...new Set([
      ...entries.map((entry) => entry.date.slice(0, 4)),
      ...expenses.map((expense) => expense.date.slice(0, 4)),
    ]),
  ].sort();

  return years.map((year) => ({
    year,
    months: Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, "0")}`;
      return {
        key,
        count:
          entries.filter((entry) => entry.date.startsWith(key)).length +
          expenses.filter((expense) => expense.date.startsWith(key)).length,
      };
    }),
  }));
}

export interface InsightRecords {
  longestTrip: string;
  highestBudget: string;
  mostVisitedCountry: string;
  lastEntryDate: string;
}

export function insightRecords(trips: Trip[], entries: JournalEntry[]): InsightRecords {
  const longestTrip = [...trips].sort(
    (left, right) => right.durationDays - left.durationDays,
  )[0];
  const highestBudget = [...trips]
    .filter((trip) => trip.budgetAmountMinor !== null)
    .sort((left, right) => (right.budgetAmountMinor ?? 0) - (left.budgetAmountMinor ?? 0))[0];

  const countryCounts = new Map<string, number>();
  for (const trip of trips) {
    for (const code of trip.countryCodes) {
      countryCounts.set(code, (countryCounts.get(code) ?? 0) + 1);
    }
  }
  const topCountry = [...countryCounts.entries()].sort(
    ([leftCode, leftCount], [rightCode, rightCount]) =>
      rightCount - leftCount || leftCode.localeCompare(rightCode),
  )[0];

  const lastEntry = [...entries].sort((left, right) => right.date.localeCompare(left.date))[0];

  return {
    longestTrip: longestTrip?.title ?? "—",
    highestBudget: highestBudget?.title ?? "—",
    mostVisitedCountry: topCountry
      ? `${countryName(topCountry[0])} · ${topCountry[1]} 段`
      : "—",
    lastEntryDate: lastEntry?.date ?? "—",
  };
}

export function expenseCsv(expenses: ExpenseWithSplits[], trips: Trip[]): string {
  const tripTitles = new Map(trips.map((trip) => [trip.id, trip.title]));
  const rows = expenses.map((expense) =>
    [
      expense.date,
      tripTitles.get(expense.tripId) ?? expense.tripId,
      categoryLabels[expense.category],
      expense.note,
      (expense.amountMinor / 100).toFixed(2),
      expense.currency,
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(","),
  );
  return ["日期,旅行,分类,备注,金额,币种", ...rows].join("\n");
}