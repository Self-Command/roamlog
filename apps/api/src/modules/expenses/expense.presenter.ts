import { ExpenseWithSplitsSchema, type ExpenseWithSplits } from "@roamlog/contracts";

import { iso, nullableIso, presentDate } from "../trips/content-values.js";
import type { ExpenseRecord } from "./expense-records.js";

/**
 * Explicit field list — the Prisma row is never spread into the contract.
 * `ExpenseWithSplitsSchema` is `.strict()`, so spreading would surface any
 * future column (or participant column) as a validation failure / 500.
 */
export function presentExpense(record: ExpenseRecord): ExpenseWithSplits {
  return ExpenseWithSplitsSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    date: presentDate(record.date),
    category: record.category,
    note: record.note,
    amountMinor: record.amountMinor,
    currency: record.currency,
    paidById: record.paidById,
    splitMode: record.splitMode,
    receiptMediaId: record.receiptMediaId,
    createdById: record.createdById,
    version: record.version,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    participants: record.participants.map((participant) => ({
      workspaceId: participant.workspaceId,
      expenseId: participant.expenseId,
      userId: participant.userId,
      shareAmountMinor: participant.shareAmountMinor,
    })),
  });
}
