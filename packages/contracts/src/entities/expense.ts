import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import {
  AmountMinorSchema,
  CurrencyCodeSchema,
  SplitModeSchema,
  validateExpenseSplit,
} from "../common/money";
import { ExpenseCategorySchema } from "./enums";

export const ExpenseSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema,
    date: DateOnlySchema,
    category: ExpenseCategorySchema,
    note: z.string().max(1000),
    amountMinor: AmountMinorSchema,
    currency: CurrencyCodeSchema,
    paidById: UuidV7Schema,
    splitMode: SplitModeSchema,
    receiptMediaId: UuidV7Schema.nullable(),
    createdById: UuidV7Schema,
    version: z.number().int().min(1),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type Expense = z.infer<typeof ExpenseSchema>;

export const ExpenseParticipantSchema = z
  .object({
    workspaceId: UuidV7Schema,
    expenseId: UuidV7Schema,
    userId: UuidV7Schema,
    shareAmountMinor: AmountMinorSchema,
  })
  .strict();
export type ExpenseParticipant = z.infer<typeof ExpenseParticipantSchema>;

export const ExpenseWithSplitsSchema = ExpenseSchema.extend({
  participants: z.array(ExpenseParticipantSchema).min(1),
}).superRefine((expense, ctx) => {
  for (const issue of validateExpenseSplit({
    amountMinor: expense.amountMinor,
    paidById: expense.paidById,
    splitMode: expense.splitMode,
    participants: expense.participants,
  })) {
    ctx.addIssue({
      code: "custom",
      message: issue,
      path: ["participants"],
    });
  }

  if (expense.participants.some((participant) => participant.expenseId !== expense.id)) {
    ctx.addIssue({
      code: "custom",
      message: "Every participant row must belong to the expense.",
      path: ["participants"],
    });
  }
});
export type ExpenseWithSplits = z.infer<typeof ExpenseWithSplitsSchema>;
