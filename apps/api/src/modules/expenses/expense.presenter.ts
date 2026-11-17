import { ExpenseWithSplitsSchema, type ExpenseWithSplits } from "@roamlog/contracts";

import { iso, nullableIso, presentDate } from "../trips/content-values.js";
import type { ExpenseRecord } from "./expense-records.js";

export function presentExpense(record: ExpenseRecord): ExpenseWithSplits {
  return ExpenseWithSplitsSchema.parse({
    ...record,
    date: presentDate(record.date),
    participants: record.participants.map((participant) => ({
      workspaceId: participant.workspaceId,
      expenseId: participant.expenseId,
      userId: participant.userId,
      shareAmountMinor: participant.shareAmountMinor,
    })),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}
