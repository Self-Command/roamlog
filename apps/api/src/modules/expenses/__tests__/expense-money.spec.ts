import { BadRequestException } from "@nestjs/common";
import { splitEqualAmount, type ExpenseWithSplits } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import {
  displayTotalOf,
  resolveExpenseShares,
  settleUpByCurrency,
  summarizeTotals,
} from "../expense-money.js";

const PAYER = "01942f30-1200-7000-8000-000000000001";
const A = "01942f30-1200-7000-8000-000000000002";
const B = "01942f30-1200-7000-8000-000000000003";

function expense(
  id: string,
  currency: string,
  amountMinor: number,
  paidById: string,
  shares: Array<{ userId: string; shareAmountMinor: number }>,
): ExpenseWithSplits {
  return {
    id,
    workspaceId: "01942f30-1200-7000-8000-000000000010",
    tripId: "01942f30-1200-7000-8000-000000000011",
    date: "2026-11-17",
    category: "food",
    note: "",
    amountMinor,
    currency,
    paidById,
    splitMode: "custom",
    receiptMediaId: null,
    createdById: paidById,
    version: 1,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    deletedAt: null,
    participants: shares.map((share) => ({ ...share, expenseId: id, workspaceId: "01942f30-1200-7000-8000-000000000010" })),
  };
}

describe("expense money rules", () => {
  it("assigns the equal-split remainder to the payer", () => {
    expect(splitEqualAmount(100, [PAYER, A, B], PAYER)).toEqual([
      { userId: PAYER, shareAmountMinor: 34 },
      { userId: A, shareAmountMinor: 33 },
      { userId: B, shareAmountMinor: 33 },
    ]);
  });

  it("rejects a custom split whose shares do not exactly equal amountMinor", () => {
    expect(() =>
      resolveExpenseShares({
        amountMinor: 100,
        paidById: PAYER,
        splitMode: "custom",
        participants: [
          { userId: PAYER, shareAmountMinor: 50 },
          { userId: A, shareAmountMinor: 40 },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it("normalizes an equal split even when clients omit shares", () => {
    expect(
      resolveExpenseShares({
        amountMinor: 101,
        paidById: PAYER,
        splitMode: "equal",
        participants: [{ userId: PAYER }, { userId: A }],
      }),
    ).toEqual([
      { userId: PAYER, shareAmountMinor: 51 },
      { userId: A, shareAmountMinor: 50 },
    ]);
  });

  it("groups original totals by currency and marks conversion as approximate", () => {
    const totals = summarizeTotals([
      { currency: "USD", amountMinor: 1000 },
      { currency: "JPY", amountMinor: 2000 },
      { currency: "USD", amountMinor: 250 },
    ]);
    expect(totals).toEqual([
      { currency: "JPY", amountMinor: 2000 },
      { currency: "USD", amountMinor: 1250 },
    ]);
    expect(displayTotalOf(totals, "USD")).toMatchObject({ currency: "USD", approx: true });
  });

  it("produces settle-up suggestions per original currency without cross-currency rounding", () => {
    const expenses = [
      expense("01942f30-1200-7000-8000-000000000100", "USD", 100, PAYER, [
        { userId: PAYER, shareAmountMinor: 50 },
        { userId: A, shareAmountMinor: 50 },
      ]),
      expense("01942f30-1200-7000-8000-000000000101", "EUR", 90, A, [
        { userId: A, shareAmountMinor: 45 },
        { userId: B, shareAmountMinor: 45 },
      ]),
    ];
    const suggestions = settleUpByCurrency(expenses);
    expect(suggestions.every((suggestion) => suggestion.currency === "USD" || suggestion.currency === "EUR")).toBe(true);
    expect(suggestions.filter((s) => s.currency === "USD")).toEqual([
      { currency: "USD", fromUserId: A, toUserId: PAYER, amountMinor: 50 },
    ]);
    expect(suggestions.filter((s) => s.currency === "EUR")).toEqual([
      { currency: "EUR", fromUserId: B, toUserId: A, amountMinor: 45 },
    ]);
  });
});
