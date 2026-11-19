import { describe, expect, it } from "vitest";

import { ExpenseWithSplitsSchema } from "@roamlog/contracts";

import type { ExpenseRecord } from "../expense-records.js";
import { presentExpense } from "../expense.presenter.js";

const OWNER_ID = "01942f30-1200-7000-8000-000000000001";
const EDITOR_ID = "01942f30-1200-7000-8000-000000000002";

function validExpenseRow(): ExpenseRecord {
  return {
    id: "01942f30-1200-7000-8000-000000000010",
    workspaceId: "01942f30-1200-7000-8000-000000000011",
    tripId: "01942f30-1200-7000-8000-000000000012",
    date: new Date("2026-11-18T00:00:00.000Z"),
    category: "food",
    note: "Gwangjang breakfast",
    amountMinor: 1_000,
    currency: "KRW",
    paidById: OWNER_ID,
    splitMode: "equal",
    receiptMediaId: null,
    createdById: OWNER_ID,
    version: 1,
    createdAt: new Date("2026-11-19T08:00:00.000Z"),
    updatedAt: new Date("2026-11-19T08:00:00.000Z"),
    deletedAt: null,
    participants: [
      {
        workspaceId: "01942f30-1200-7000-8000-000000000011",
        expenseId: "01942f30-1200-7000-8000-000000000010",
        userId: OWNER_ID,
        shareAmountMinor: 500,
      },
      {
        workspaceId: "01942f30-1200-7000-8000-000000000011",
        expenseId: "01942f30-1200-7000-8000-000000000010",
        userId: EDITOR_ID,
        shareAmountMinor: 500,
      },
    ],
  };
}

/**
 * Regression guard: `ExpenseWithSplitsSchema` is `.strict()` (it extends the
 * strict `ExpenseSchema`) and the presenter used to spread the Prisma row —
 * including each participant row — into it. A new expense or participant
 * column would 500 `GET /v1/trips/{tripId}/expenses` and the budget read paths.
 */
describe("presentExpense ignores columns the contract does not declare", () => {
  it("does not throw or leak a future column", () => {
    const record = {
      ...validExpenseRow(),
      someFutureColumn: "x",
      moderatedAt: new Date("2026-11-19T08:00:00.000Z"),
    };

    const presented = presentExpense(record);

    expect(() => presentExpense(record)).not.toThrow();
    expect(ExpenseWithSplitsSchema.parse(presented)).toBeTruthy();
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented).not.toHaveProperty("moderatedAt");
    expect(presented.participants).toHaveLength(2);
    expect(presented.participants[0]).not.toHaveProperty("someFutureColumn");
  });

  it("keeps nullable columns present as null", () => {
    const presented = presentExpense(validExpenseRow());

    expect(presented.receiptMediaId).toBeNull();
    expect(presented.deletedAt).toBeNull();
    expect(ExpenseWithSplitsSchema.parse(presented)).toEqual(presented);
  });
});