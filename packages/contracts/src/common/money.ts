import { z } from "zod";

import { UuidV7Schema } from "./ids";

export const CurrencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/)
  .describe("ISO 4217 uppercase currency code.");
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const AmountMinorSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("Non-negative integer amount in the currency's minor unit.");
export type AmountMinor = z.infer<typeof AmountMinorSchema>;

export const MoneySchema = z
  .object({
    amountMinor: AmountMinorSchema,
    currency: CurrencyCodeSchema,
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

export const FxRateSchema = z
  .object({
    fromCurrency: CurrencyCodeSchema,
    toCurrency: CurrencyCodeSchema,
    rate: z.number().positive(),
    asOf: z.iso.date(),
  })
  .strict();
export type FxRate = z.infer<typeof FxRateSchema>;

export const ApproximateMoneySchema = MoneySchema.extend({
  approx: z.literal(true),
  sourceCurrency: CurrencyCodeSchema,
  fxRate: z.number().positive(),
});
export type ApproximateMoney = z.infer<typeof ApproximateMoneySchema>;

export const SplitModeSchema = z.enum(["equal", "custom"]);
export type SplitMode = z.infer<typeof SplitModeSchema>;

export const ExpenseSplitParticipantSchema = z
  .object({
    userId: UuidV7Schema,
    shareAmountMinor: AmountMinorSchema,
  })
  .strict();
export type ExpenseSplitParticipant = z.infer<typeof ExpenseSplitParticipantSchema>;

export const ExpenseSplitSchema = z
  .object({
    amountMinor: AmountMinorSchema,
    paidById: UuidV7Schema,
    splitMode: SplitModeSchema,
    participants: z.array(ExpenseSplitParticipantSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of validateExpenseSplit(value)) {
      ctx.addIssue({
        code: "custom",
        message: EXPENSE_SPLIT_MESSAGES[issue],
        path: ["participants"],
      });
    }
  });
export type ExpenseSplit = z.infer<typeof ExpenseSplitSchema>;

export type ExpenseSplitIssue =
  | "EXPENSE_SPLIT_DUPLICATE_PARTICIPANT"
  | "EXPENSE_SPLIT_PAYER_MISSING"
  | "EXPENSE_SPLIT_TOTAL_MISMATCH"
  | "EXPENSE_SPLIT_EQUAL_MISMATCH";

export const EXPENSE_SPLIT_MESSAGES: Record<ExpenseSplitIssue, string> = {
  EXPENSE_SPLIT_DUPLICATE_PARTICIPANT: "Expense participants must be unique.",
  EXPENSE_SPLIT_PAYER_MISSING: "The payer must be one of the expense participants.",
  EXPENSE_SPLIT_TOTAL_MISMATCH: "Participant shares must add up to amountMinor.",
  EXPENSE_SPLIT_EQUAL_MISMATCH:
    "Equal splits must use integer division with the remainder assigned to the payer.",
};

export function splitEqualAmount(
  amountMinor: number,
  participantIds: readonly string[],
  payerId: string,
): Array<{ userId: string; shareAmountMinor: number }> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("amountMinor must be a non-negative safe integer.");
  }
  if (participantIds.length === 0) {
    throw new Error("At least one participant is required.");
  }
  if (new Set(participantIds).size !== participantIds.length) {
    throw new Error("Expense participants must be unique.");
  }
  if (!participantIds.includes(payerId)) {
    throw new Error("The payer must be one of the expense participants.");
  }

  const base = Math.floor(amountMinor / participantIds.length);
  const remainder = amountMinor - base * participantIds.length;

  return participantIds.map((userId) => ({
    userId,
    shareAmountMinor: userId === payerId ? base + remainder : base,
  }));
}

export function validateExpenseSplit(input: {
  amountMinor: number;
  paidById: string;
  splitMode: "equal" | "custom";
  participants: readonly { userId: string; shareAmountMinor: number }[];
}): ExpenseSplitIssue[] {
  const issues = new Set<ExpenseSplitIssue>();
  const ids = input.participants.map((participant) => participant.userId);

  if (new Set(ids).size !== ids.length) {
    issues.add("EXPENSE_SPLIT_DUPLICATE_PARTICIPANT");
  }
  if (!ids.includes(input.paidById)) {
    issues.add("EXPENSE_SPLIT_PAYER_MISSING");
  }

  const total = input.participants.reduce(
    (sum, participant) => sum + participant.shareAmountMinor,
    0,
  );
  if (total !== input.amountMinor) {
    issues.add("EXPENSE_SPLIT_TOTAL_MISMATCH");
  }

  if (input.splitMode === "equal" && issues.size === 0) {
    const expected = new Map(
      splitEqualAmount(input.amountMinor, ids, input.paidById).map((participant) => [
        participant.userId,
        participant.shareAmountMinor,
      ]),
    );
    if (
      input.participants.some(
        (participant) => participant.shareAmountMinor !== expected.get(participant.userId),
      )
    ) {
      issues.add("EXPENSE_SPLIT_EQUAL_MISMATCH");
    }
  }

  return [...issues];
}
