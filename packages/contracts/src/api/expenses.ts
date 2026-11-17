import { z } from "zod";

import { DateOnlySchema, UuidV7Schema } from "../common/ids";
import {
  AmountMinorSchema,
  CurrencyCodeSchema,
  ExpenseSplitSchema,
  SplitModeSchema,
  validateExpenseSplit,
} from "../common/money";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { ExpenseCategorySchema } from "../entities/enums";
import { ExpenseWithSplitsSchema } from "../entities/expense";
import { MessageResponseSchema } from "./common";

export const ExpenseParticipantInputSchema = z
  .object({
    userId: UuidV7Schema,
    shareAmountMinor: AmountMinorSchema.optional(),
  })
  .strict();
export type ExpenseParticipantInput = z.infer<typeof ExpenseParticipantInputSchema>;

export const ExpenseListQuerySchema = CursorQuerySchema.extend({
  category: ExpenseCategorySchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  participantId: UuidV7Schema.optional(),
  sort: createSortSchema(["date", "createdAt", "amountMinor"]).optional(),
});
export type ExpenseListQuery = z.infer<typeof ExpenseListQuerySchema>;

export const ExpensePageSchema = CursorPageSchema(ExpenseWithSplitsSchema);
export type ExpensePage = z.infer<typeof ExpensePageSchema>;

function shareInputIssues(value: {
  amountMinor: number;
  paidById: string;
  splitMode: "equal" | "custom";
  participants: readonly { userId: string; shareAmountMinor?: number }[];
}): string[] {
  const issues = new Set<string>();
  const ids = value.participants.map((participant) => participant.userId);

  if (new Set(ids).size !== ids.length) {
    issues.add("EXPENSE_SPLIT_DUPLICATE_PARTICIPANT");
  }
  if (!ids.includes(value.paidById)) {
    issues.add("EXPENSE_SPLIT_PAYER_MISSING");
  }

  const hasShareValues = value.participants.some(
    (participant) => participant.shareAmountMinor !== undefined,
  );
  if (value.splitMode === "custom" && value.participants.some((p) => p.shareAmountMinor === undefined)) {
    issues.add("EXPENSE_SPLIT_SHARES_REQUIRED");
    return [...issues];
  }
  if (value.splitMode === "equal" && hasShareValues) {
    if (value.participants.some((participant) => participant.shareAmountMinor === undefined)) {
      issues.add("EXPENSE_SPLIT_SHARES_REQUIRED");
      return [...issues];
    }
  }

  if (value.splitMode === "custom" || hasShareValues) {
    const parsed = ExpenseSplitSchema.safeParse({
      amountMinor: value.amountMinor,
      paidById: value.paidById,
      splitMode: value.splitMode,
      participants: value.participants.map((participant) => ({
        userId: participant.userId,
        shareAmountMinor: participant.shareAmountMinor ?? -1,
      })),
    });
    if (!parsed.success) {
      for (const issue of validateExpenseSplit({
        amountMinor: value.amountMinor,
        paidById: value.paidById,
        splitMode: value.splitMode,
        participants: value.participants.map((participant) => ({
          userId: participant.userId,
          shareAmountMinor: participant.shareAmountMinor ?? -1,
        })),
      })) {
        issues.add(issue);
      }
    }
  }

  return [...issues];
}

export const CreateExpenseRequestSchema = z
  .object({
    date: DateOnlySchema,
    category: ExpenseCategorySchema,
    note: z.string().max(1000),
    amountMinor: AmountMinorSchema,
    currency: CurrencyCodeSchema,
    paidById: UuidV7Schema,
    splitMode: SplitModeSchema,
    receiptMediaId: UuidV7Schema.nullable().optional(),
    participants: z.array(ExpenseParticipantInputSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of shareInputIssues(value)) {
      ctx.addIssue({ code: "custom", message: issue, path: ["participants"] });
    }
  });
export type CreateExpenseRequest = z.infer<typeof CreateExpenseRequestSchema>;

export const UpdateExpenseRequestSchema = z
  .object({
    version: z.number().int().min(1),
    date: DateOnlySchema.optional(),
    category: ExpenseCategorySchema.optional(),
    note: z.string().max(1000).optional(),
    amountMinor: AmountMinorSchema.optional(),
    currency: CurrencyCodeSchema.optional(),
    paidById: UuidV7Schema.optional(),
    splitMode: SplitModeSchema.optional(),
    receiptMediaId: UuidV7Schema.nullable().optional(),
    participants: z.array(ExpenseParticipantInputSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length <= 1) {
      ctx.addIssue({ code: "custom", message: "At least one expense field must change." });
    }
    if (
      value.participants !== undefined &&
      (value.amountMinor === undefined ||
        value.paidById === undefined ||
        value.splitMode === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Changing participants requires amountMinor, paidById, and splitMode together.",
        path: ["participants"],
      });
      return;
    }
    if (
      value.participants !== undefined &&
      value.amountMinor !== undefined &&
      value.paidById !== undefined &&
      value.splitMode !== undefined
    ) {
      for (const issue of shareInputIssues({
        amountMinor: value.amountMinor,
        paidById: value.paidById,
        splitMode: value.splitMode,
        participants: value.participants,
      })) {
        ctx.addIssue({ code: "custom", message: issue, path: ["participants"] });
      }
    }
  });
export type UpdateExpenseRequest = z.infer<typeof UpdateExpenseRequestSchema>;

export const CurrencyTotalSchema = z
  .object({
    currency: CurrencyCodeSchema,
    amountMinor: AmountMinorSchema,
  })
  .strict();
export type CurrencyTotal = z.infer<typeof CurrencyTotalSchema>;

export const ApproximateCurrencyTotalSchema = CurrencyTotalSchema.extend({
  approx: z.literal(true),
});
export type ApproximateCurrencyTotal = z.infer<typeof ApproximateCurrencyTotalSchema>;

export const BudgetCategorySummarySchema = z
  .object({
    category: ExpenseCategorySchema,
    totals: z.array(CurrencyTotalSchema),
  })
  .strict();
export type BudgetCategorySummary = z.infer<typeof BudgetCategorySummarySchema>;

export const BudgetSummarySchema = z
  .object({
    tripId: UuidV7Schema,
    displayCurrency: CurrencyCodeSchema,
    originalTotals: z.array(CurrencyTotalSchema),
    displayTotal: ApproximateCurrencyTotalSchema,
    categories: z.array(BudgetCategorySummarySchema),
    expenseCount: z.number().int().nonnegative(),
    overBudget: z.boolean(),
  })
  .strict();
export type BudgetSummary = z.infer<typeof BudgetSummarySchema>;

export const SettlementSuggestionSchema = z
  .object({
    currency: CurrencyCodeSchema,
    fromUserId: UuidV7Schema,
    toUserId: UuidV7Schema,
    amountMinor: AmountMinorSchema,
  })
  .strict();
export type SettlementSuggestion = z.infer<typeof SettlementSuggestionSchema>;

export const SettleUpResponseSchema = z
  .object({
    tripId: UuidV7Schema,
    suggestions: z.array(SettlementSuggestionSchema),
  })
  .strict();
export type SettleUpResponse = z.infer<typeof SettleUpResponseSchema>;

export const DeleteExpenseResponseSchema = MessageResponseSchema;
export type DeleteExpenseResponse = z.infer<typeof DeleteExpenseResponseSchema>;
