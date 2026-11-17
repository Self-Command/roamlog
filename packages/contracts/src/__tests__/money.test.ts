import { describe, expect, it } from "vitest";

import {
  ApproximateMoneySchema,
  ExpenseSplitSchema,
  MoneySchema,
  splitEqualAmount,
  validateExpenseSplit,
} from "../common/money";

const A = "0192f4c5-6a7b-7c8d-9e0f-123456789abc";
const B = "0192f4c5-6a7b-7c8d-9e0f-123456789abd";
const C = "0192f4c5-6a7b-7c8d-9e0f-123456789abe";

describe("money contracts", () => {
  it("keeps money in integer minor units with ISO currencies", () => {
    expect(MoneySchema.parse({ amountMinor: 1299, currency: "EUR" }).amountMinor).toBe(1299);
    expect(MoneySchema.safeParse({ amountMinor: 12.99, currency: "EUR" }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountMinor: 1299, currency: "eur" }).success).toBe(false);
    expect(
      ApproximateMoneySchema.parse({
        amountMinor: 2100,
        currency: "USD",
        approx: true,
        sourceCurrency: "JPY",
        fxRate: 0.0067,
      }).approx,
    ).toBe(true);
  });
});

describe("expense splits", () => {
  it("distributes equal splits and gives the remainder to the payer", () => {
    expect(splitEqualAmount(100, [A, B, C], B)).toEqual([
      { userId: A, shareAmountMinor: 33 },
      { userId: B, shareAmountMinor: 34 },
      { userId: C, shareAmountMinor: 33 },
    ]);
  });

  it("rejects duplicate participants and a payer outside the split", () => {
    expect(() => splitEqualAmount(100, [A, A], A)).toThrow();
    expect(() => splitEqualAmount(100, [A, B], C)).toThrow();
  });

  it("validates custom totals and equal remainder semantics", () => {
    const custom = ExpenseSplitSchema.safeParse({
      amountMinor: 100,
      paidById: A,
      splitMode: "custom",
      participants: [
        { userId: A, shareAmountMinor: 50 },
        { userId: B, shareAmountMinor: 50 },
      ],
    });
    expect(custom.success).toBe(true);
    expect(
      validateExpenseSplit({
        amountMinor: 100,
        paidById: A,
        splitMode: "custom",
        participants: [
          { userId: A, shareAmountMinor: 50 },
          { userId: B, shareAmountMinor: 49 },
        ],
      }),
    ).toContain("EXPENSE_SPLIT_TOTAL_MISMATCH");

    expect(
      ExpenseSplitSchema.safeParse({
        amountMinor: 100,
        paidById: A,
        splitMode: "equal",
        participants: [
          { userId: A, shareAmountMinor: 50 },
          { userId: B, shareAmountMinor: 50 },
        ],
      }).success,
    ).toBe(true);
  });
});
