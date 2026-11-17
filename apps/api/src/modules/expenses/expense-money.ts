import { BadRequestException } from "@nestjs/common";
import {
  splitEqualAmount,
  validateExpenseSplit,
  type CurrencyTotal,
  type ExpenseWithSplits,
  type SettlementSuggestion,
  type SplitMode,
} from "@roamlog/contracts";

export interface ExpenseParticipantInputLike {
  userId: string;
  shareAmountMinor?: number;
}

/**
 * Static v1 FX table expressed as units of USD per one unit of each currency.
 * The service always labels converted aggregates with `approx: true`.
 */
export const USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CNY: 0.14,
  JPY: 0.0067,
  KRW: 0.00072,
  THB: 0.028,
  SGD: 0.74,
  HKD: 0.128,
  AUD: 0.66,
  CAD: 0.73,
  CHF: 1.13,
  TWD: 0.031,
  MYR: 0.22,
  VND: 0.000039,
  INR: 0.012,
  IDR: 0.000063,
  NZD: 0.61,
};

export function fxRate(fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) {
    return 1;
  }
  const from = USD_RATES[fromCurrency];
  const to = USD_RATES[toCurrency];
  if (!from || !to) {
    throw new BadRequestException({
      code: "UNSUPPORTED_CURRENCY",
      message: `No static FX rate is configured for ${!from ? fromCurrency : toCurrency}.`,
    });
  }
  return from / to;
}

export function convertApprox(amountMinor: number, from: string, to: string): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError("amountMinor must be a non-negative safe integer");
  }
  return Math.round(amountMinor * fxRate(from, to));
}

export function resolveExpenseShares(input: {
  amountMinor: number;
  paidById: string;
  splitMode: SplitMode;
  participants: readonly ExpenseParticipantInputLike[];
}): Array<{ userId: string; shareAmountMinor: number }> {
  const ids = input.participants.map((participant) => participant.userId);
  if (new Set(ids).size !== ids.length) {
    throw splitError("EXPENSE_SPLIT_DUPLICATE_PARTICIPANT");
  }
  if (!ids.includes(input.paidById)) {
    throw splitError("EXPENSE_SPLIT_PAYER_MISSING");
  }

  if (input.splitMode === "equal") {
    if (input.participants.some((participant) => participant.shareAmountMinor !== undefined)) {
      assertSplit({
        amountMinor: input.amountMinor,
        paidById: input.paidById,
        splitMode: "equal",
        participants: input.participants.map((participant) => ({
          userId: participant.userId,
          shareAmountMinor: participant.shareAmountMinor ?? -1,
        })),
      });
    }
    return splitEqualAmount(input.amountMinor, ids, input.paidById);
  }

  if (input.participants.some((participant) => participant.shareAmountMinor === undefined)) {
    throw splitError("EXPENSE_SPLIT_SHARES_REQUIRED");
  }
  const shares = input.participants.map((participant) => ({
    userId: participant.userId,
    shareAmountMinor: participant.shareAmountMinor ?? -1,
  }));
  assertSplit({
    amountMinor: input.amountMinor,
    paidById: input.paidById,
    splitMode: "custom",
    participants: shares,
  });
  return shares;
}

function assertSplit(input: {
  amountMinor: number;
  paidById: string;
  splitMode: SplitMode;
  participants: Array<{ userId: string; shareAmountMinor: number }>;
}): void {
  const issues = validateExpenseSplit(input);
  if (issues.length > 0) {
    throw splitError(issues[0] ?? "EXPENSE_SPLIT_TOTAL_MISMATCH");
  }
}

function splitError(code: string): BadRequestException {
  return new BadRequestException({
    code,
    message: "The expense split is invalid.",
  });
}

export function summarizeTotals(expenses: readonly { amountMinor: number; currency: string }[]) {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amountMinor);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountMinor]) => ({ currency, amountMinor })) satisfies CurrencyTotal[];
}

export function summarizeCategories(
  expenses: readonly { amountMinor: number; currency: string; category: string }[],
) {
  const byCategory = new Map<string, Map<string, number>>();
  for (const expense of expenses) {
    const totals = byCategory.get(expense.category) ?? new Map<string, number>();
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.amountMinor);
    byCategory.set(expense.category, totals);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, totals]) => ({
      category,
      totals: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amountMinor]) => ({ currency, amountMinor })),
    }));
}

export function displayTotalOf(
  originalTotals: readonly CurrencyTotal[],
  displayCurrency: string,
): { currency: string; amountMinor: number; approx: true } {
  const amountMinor = originalTotals.reduce(
    (sum, total) => sum + convertApprox(total.amountMinor, total.currency, displayCurrency),
    0,
  );
  return { currency: displayCurrency, amountMinor, approx: true };
}

export interface SettlementBalance {
  currency: string;
  balances: Map<string, number>;
}

export function computeBalances(
  expenses: readonly Pick<
    ExpenseWithSplits,
    "currency" | "amountMinor" | "paidById" | "participants"
  >[],
): SettlementBalance[] {
  const byCurrency = new Map<string, Map<string, number>>();
  for (const expense of expenses) {
    const balances = byCurrency.get(expense.currency) ?? new Map<string, number>();
    balances.set(expense.paidById, (balances.get(expense.paidById) ?? 0) + expense.amountMinor);
    for (const participant of expense.participants) {
      balances.set(
        participant.userId,
        (balances.get(participant.userId) ?? 0) - participant.shareAmountMinor,
      );
    }
    byCurrency.set(expense.currency, balances);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, balances]) => ({ currency, balances }));
}

export function settleUpByCurrency(
  expenses: readonly Pick<
    ExpenseWithSplits,
    "currency" | "amountMinor" | "paidById" | "participants"
  >[],
): SettlementSuggestion[] {
  const suggestions: SettlementSuggestion[] = [];

  for (const { currency, balances } of computeBalances(expenses)) {
    const creditors = [...balances.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([userId, amount]) => ({ userId, amount }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
    const debtors = [...balances.entries()]
      .filter(([, amount]) => amount < 0)
      .map(([userId, amount]) => ({ userId, amount: -amount }))
      .sort((a, b) => a.userId.localeCompare(b.userId));

    let creditorIndex = 0;
    let debtorIndex = 0;
    while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
      const creditor = creditors[creditorIndex];
      const debtor = debtors[debtorIndex];
      if (!creditor || !debtor) {
        break;
      }
      const amountMinor = Math.min(creditor.amount, debtor.amount);
      if (amountMinor > 0) {
        suggestions.push({
          currency,
          fromUserId: debtor.userId,
          toUserId: creditor.userId,
          amountMinor,
        });
      }
      creditor.amount -= amountMinor;
      debtor.amount -= amountMinor;
      if (creditor.amount === 0) {
        creditorIndex += 1;
      }
      if (debtor.amount === 0) {
        debtorIndex += 1;
      }
    }
  }

  return suggestions;
}
