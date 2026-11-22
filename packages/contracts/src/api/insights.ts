import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import { ExpenseCategorySchema } from "../entities/enums";

export const InsightsMonthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("Calendar month in YYYY-MM form.");
export type InsightsMonthKey = z.infer<typeof InsightsMonthKeySchema>;

export const InsightsYearSchema = z
  .string()
  .regex(/^\d{4}$/)
  .describe("Calendar year in YYYY form.");
export type InsightsYear = z.infer<typeof InsightsYearSchema>;

export const InsightsQuerySchema = z
  .object({
    month: InsightsMonthKeySchema.optional(),
  })
  .strict();
export type InsightsQuery = z.infer<typeof InsightsQuerySchema>;

export const InsightsExpensesCsvQuerySchema = z.object({}).strict();
export type InsightsExpensesCsvQuery = z.infer<typeof InsightsExpensesCsvQuerySchema>;

export const InsightsStatsSchema = z
  .object({
    tripCount: z.number().int().nonnegative(),
    totalDays: z.number().int().nonnegative(),
    countries: z.number().int().nonnegative(),
    cities: z.number().int().nonnegative(),
    years: z.array(InsightsYearSchema),
  })
  .strict();
export type InsightsStats = z.infer<typeof InsightsStatsSchema>;

export const InsightsAnnualTripsPointSchema = z
  .object({
    year: InsightsYearSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
export type InsightsAnnualTripsPoint = z.infer<typeof InsightsAnnualTripsPointSchema>;

export const InsightsMonthlySpendPointSchema = z
  .object({
    key: InsightsMonthKeySchema,
    label: z.string().min(1).max(8),
    amountMinor: AmountMinorSchema,
  })
  .strict();
export type InsightsMonthlySpendPoint = z.infer<typeof InsightsMonthlySpendPointSchema>;

export const InsightsCategoryTotalSchema = z
  .object({
    category: ExpenseCategorySchema,
    total: AmountMinorSchema,
  })
  .strict();
export type InsightsCategoryTotal = z.infer<typeof InsightsCategoryTotalSchema>;

export const InsightsBudgetRowSchema = z
  .object({
    tripId: UuidV7Schema,
    tripTitle: z.string().min(1),
    destination: z.string().nullable(),
    currency: CurrencyCodeSchema,
    budgetAmountMinor: AmountMinorSchema,
    spentAmountMinor: AmountMinorSchema,
    hasOtherCurrencySpend: z.boolean(),
  })
  .strict();
export type InsightsBudgetRow = z.infer<typeof InsightsBudgetRowSchema>;

export const InsightsHeatmapMonthSchema = z
  .object({
    key: InsightsMonthKeySchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
export type InsightsHeatmapMonth = z.infer<typeof InsightsHeatmapMonthSchema>;

export const InsightsHeatmapRowSchema = z
  .object({
    year: InsightsYearSchema,
    months: z.array(InsightsHeatmapMonthSchema).min(12).max(12),
  })
  .strict();
export type InsightsHeatmapRow = z.infer<typeof InsightsHeatmapRowSchema>;

export const InsightsLongestTripSchema = z
  .object({
    tripId: UuidV7Schema,
    title: z.string().min(1),
    durationDays: z.number().int().positive(),
  })
  .strict();
export type InsightsLongestTrip = z.infer<typeof InsightsLongestTripSchema>;

export const InsightsHighestBudgetSchema = z
  .object({
    tripId: UuidV7Schema,
    title: z.string().min(1),
    budgetAmountMinor: AmountMinorSchema,
    currency: CurrencyCodeSchema.nullable(),
  })
  .strict();
export type InsightsHighestBudget = z.infer<typeof InsightsHighestBudgetSchema>;

export const InsightsMostVisitedCountrySchema = z
  .object({
    countryCode: CountryCodeSchema,
    tripCount: z.number().int().positive(),
  })
  .strict();
export type InsightsMostVisitedCountry = z.infer<typeof InsightsMostVisitedCountrySchema>;

export const InsightsRecordsSchema = z
  .object({
    longestTrip: InsightsLongestTripSchema.nullable(),
    highestBudget: InsightsHighestBudgetSchema.nullable(),
    mostVisitedCountry: InsightsMostVisitedCountrySchema.nullable(),
    lastEntryDate: DateOnlySchema.nullable(),
  })
  .strict();
export type InsightsRecords = z.infer<typeof InsightsRecordsSchema>;

export const InsightsCurrencyTotalSchema = z
  .object({
    currency: CurrencyCodeSchema,
    amountMinor: AmountMinorSchema,
  })
  .strict();
export type InsightsCurrencyTotal = z.infer<typeof InsightsCurrencyTotalSchema>;

export const WorkspaceInsightsSchema = z
  .object({
    workspaceId: UuidV7Schema,
    currency: CurrencyCodeSchema,
    month: InsightsMonthKeySchema,
    stats: InsightsStatsSchema,
    annualTrips: z.array(InsightsAnnualTripsPointSchema),
    monthlySpend: z.array(InsightsMonthlySpendPointSchema).min(12).max(12),
    categoryTotals: z.array(InsightsCategoryTotalSchema),
    budgetRows: z.array(InsightsBudgetRowSchema).max(6),
    heatmap: z.array(InsightsHeatmapRowSchema),
    records: InsightsRecordsSchema,
    currencyTotals: z.array(InsightsCurrencyTotalSchema),
    expenseCount: z.number().int().nonnegative(),
    currencyExpenseCount: z.number().int().nonnegative(),
  })
  .strict();
export type WorkspaceInsights = z.infer<typeof WorkspaceInsightsSchema>;
