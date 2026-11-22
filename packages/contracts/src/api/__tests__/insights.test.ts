import { describe, expect, it } from "vitest";

import {
  InsightsExpensesCsvQuerySchema,
  InsightsQuerySchema,
  WorkspaceInsightsSchema,
  type WorkspaceInsights,
} from "../../index";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000910";
const TRIP_ID = "01942f30-1200-7000-8000-000000000911";
const SECOND_TRIP_ID = "01942f30-1200-7000-8000-000000000912";

const MONTH_KEYS = [
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
] as const;

const monthlySpend = MONTH_KEYS.map((key, index) => ({
  key,
  label: `${key.slice(5)}月`,
  amountMinor: index * 1000,
}));

const heatmapMonths = Array.from({ length: 12 }, (_, index) => ({
  key: `2026-${String(index + 1).padStart(2, "0")}`,
  count: index % 3,
}));

const BUDGET_ROW = {
  tripId: TRIP_ID,
  tripTitle: "Kyoto in November",
  destination: "Kyoto",
  currency: "CNY",
  budgetAmountMinor: 500_000,
  spentAmountMinor: 320_000,
  hasOtherCurrencySpend: true,
} as const;

const SECOND_BUDGET_ROW = {
  tripId: SECOND_TRIP_ID,
  tripTitle: "Shanghai weekend",
  destination: null,
  currency: "CNY",
  budgetAmountMinor: 100_000,
  spentAmountMinor: 0,
  hasOtherCurrencySpend: false,
} as const;

const HIGHEST_BUDGET = {
  tripId: TRIP_ID,
  title: "Kyoto in November",
  budgetAmountMinor: 500_000,
  currency: "CNY",
} as const;

const emptyInsights = {
  workspaceId: WORKSPACE_ID,
  currency: "CNY",
  month: "2026-11",
  stats: {
    tripCount: 0,
    totalDays: 0,
    countries: 0,
    cities: 0,
    years: [],
  },
  annualTrips: [],
  monthlySpend: monthlySpend.map((point) => ({ ...point, amountMinor: 0 })),
  categoryTotals: [],
  budgetRows: [],
  heatmap: [],
  records: {
    longestTrip: null,
    highestBudget: null,
    mostVisitedCountry: null,
    lastEntryDate: null,
  },
  currencyTotals: [],
  expenseCount: 0,
  currencyExpenseCount: 0,
} as const;

const fullInsights = {
  workspaceId: WORKSPACE_ID,
  currency: "CNY",
  month: "2026-11",
  stats: {
    tripCount: 4,
    totalDays: 27,
    countries: 3,
    cities: 6,
    years: ["2024", "2025", "2026"],
  },
  annualTrips: [
    { year: "2024", count: 1 },
    { year: "2025", count: 1 },
    { year: "2026", count: 2 },
  ],
  monthlySpend: monthlySpend.map((point, index) => ({
    ...point,
    amountMinor: (index + 1) * 1250,
  })),
  categoryTotals: [
    { category: "transport", total: 12_000 },
    { category: "stay", total: 30_000 },
    { category: "food", total: 4_500 },
    { category: "activity", total: 2_000 },
    { category: "shopping", total: 800 },
    { category: "other", total: 300 },
  ],
  budgetRows: [BUDGET_ROW, SECOND_BUDGET_ROW],
  heatmap: [
    {
      year: "2025",
      months: heatmapMonths.map((point, index) => ({
        key: `2025-${point.key.slice(5)}`,
        count: index % 2,
      })),
    },
    { year: "2026", months: heatmapMonths },
  ],
  records: {
    longestTrip: {
      tripId: TRIP_ID,
      title: "Kyoto in November",
      durationDays: 8,
    },
    highestBudget: { ...HIGHEST_BUDGET, currency: null },
    mostVisitedCountry: { countryCode: "JP", tripCount: 2 },
    lastEntryDate: "2026-11-19",
  },
  currencyTotals: [
    { currency: "CNY", amountMinor: 48_700 },
    { currency: "JPY", amountMinor: 25_000 },
  ],
  expenseCount: 14,
  currencyExpenseCount: 12,
} as const;

describe("insights contracts", () => {
  it("accepts the minimal empty-workspace response", () => {
    const parsed = WorkspaceInsightsSchema.parse(emptyInsights);

    expect(parsed.monthlySpend).toHaveLength(12);
    expect(parsed.monthlySpend.every((point) => point.amountMinor === 0)).toBe(true);
    expect(parsed.records).toEqual({
      longestTrip: null,
      highestBudget: null,
      mostVisitedCountry: null,
      lastEntryDate: null,
    });
    expect(parsed.budgetRows).toEqual([]);
  });

  it("accepts the fully populated response", () => {
    const parsed = WorkspaceInsightsSchema.parse(fullInsights);

    expect(parsed.stats.years).toEqual(["2024", "2025", "2026"]);
    expect(parsed.categoryTotals).toHaveLength(6);
    expect(parsed.budgetRows).toHaveLength(2);
    expect(parsed.heatmap).toHaveLength(2);
    expect(parsed.heatmap[0]?.months).toHaveLength(12);
    expect(parsed.records.mostVisitedCountry?.countryCode).toBe("JP");
    expect(parsed.currencyTotals[1]?.currency).toBe("JPY");
  });

  it("exports the response schema and type from the package root", () => {
    const parsed: WorkspaceInsights = WorkspaceInsightsSchema.parse(emptyInsights);

    expect(parsed.workspaceId).toBe(WORKSPACE_ID);
  });

  it("rejects responses missing required fields", () => {
    const missingStats: Record<string, unknown> = { ...emptyInsights };
    delete missingStats.stats;
    expect(WorkspaceInsightsSchema.safeParse(missingStats).success).toBe(false);

    const missingLastEntryDate: Record<string, unknown> = { ...emptyInsights.records };
    delete missingLastEntryDate.lastEntryDate;
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        records: missingLastEntryDate,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields at the root and in nested objects", () => {
    expect(
      WorkspaceInsightsSchema.safeParse({ ...emptyInsights, unexpected: true }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        stats: { ...emptyInsights.stats, unexpected: 1 },
      }).success,
    ).toBe(false);
  });

  it("accepts nullable record and budget fields", () => {
    const parsed = WorkspaceInsightsSchema.parse({
      ...emptyInsights,
      budgetRows: [{ ...BUDGET_ROW, destination: null }],
      records: {
        longestTrip: null,
        highestBudget: { ...HIGHEST_BUDGET, currency: null },
        mostVisitedCountry: null,
        lastEntryDate: null,
      },
    });

    expect(parsed.budgetRows[0]?.destination).toBeNull();
    expect(parsed.records.highestBudget?.currency).toBeNull();
  });

  it("rejects invalid enum values", () => {
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...fullInsights,
        categoryTotals: [{ category: "souvenir", total: 100 }],
      }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({ ...fullInsights, currency: "cny" }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...fullInsights,
        records: {
          ...fullInsights.records,
          mostVisitedCountry: { countryCode: "JPN", tripCount: 1 },
        },
      }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({ ...fullInsights, month: "2026-13" }).success,
    ).toBe(false);
  });

  it("enforces twelve spend/heatmap buckets and at most six budget rows", () => {
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        monthlySpend: monthlySpend.slice(0, 11),
      }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        heatmap: [{ year: "2026", months: heatmapMonths.slice(0, 11) }],
      }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        budgetRows: Array.from({ length: 7 }, () => BUDGET_ROW),
      }).success,
    ).toBe(false);
  });

  it("parses the optional month and rejects malformed query values", () => {
    expect(InsightsQuerySchema.parse({})).toEqual({});
    expect(InsightsQuerySchema.parse({ month: "2026-11" })).toEqual({ month: "2026-11" });

    for (const month of [
      "2026-00",
      "2026-13",
      "2026-1",
      "26-11",
      "2026-11-01",
      "2026-11T00:00:00Z",
      " 2026-11 ",
    ]) {
      expect(InsightsQuerySchema.safeParse({ month }).success).toBe(false);
    }

    expect(
      InsightsQuerySchema.safeParse({ month: "2026-11", unexpected: true }).success,
    ).toBe(false);
  });

  it("rejects workspace ids that are not UUIDv7", () => {
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        workspaceId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      WorkspaceInsightsSchema.safeParse({
        ...emptyInsights,
        workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(false);
  });

  it("keeps the CSV endpoint query strict and empty", () => {
    expect(InsightsExpensesCsvQuerySchema.parse({})).toEqual({});
    expect(InsightsExpensesCsvQuerySchema.safeParse({ month: "2026-11" }).success).toBe(false);
  });
});
