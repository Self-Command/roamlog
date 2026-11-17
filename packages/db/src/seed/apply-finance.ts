import type { SeedDataset } from "./types.js";
import {
  dateOnly,
  dateTime,
  nullableDateTime,
  type SeedTransaction,
} from "./apply-utils.js";

export async function applyFinance(
  tx: SeedTransaction,
  data: SeedDataset,
): Promise<void> {
  for (const expense of data.expenses) {
    const fields = {
      workspaceId: expense.workspaceId,
      tripId: expense.tripId,
      date: dateOnly(expense.date),
      category: expense.category,
      note: expense.note,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      paidById: expense.paidById,
      splitMode: expense.splitMode,
      receiptMediaId: expense.receiptMediaId,
      createdById: expense.createdById,
      version: expense.version,
      createdAt: dateTime(expense.createdAt),
      updatedAt: dateTime(expense.updatedAt),
      deletedAt: nullableDateTime(expense.deletedAt),
    };
    await tx.expense.upsert({
      where: { id: expense.id },
      update: fields,
      create: { id: expense.id, ...fields },
    });

    for (const participant of expense.participants) {
      const shareFields = {
        workspaceId: participant.workspaceId,
        expenseId: participant.expenseId,
        userId: participant.userId,
        shareAmountMinor: participant.shareAmountMinor,
      };
      await tx.expenseParticipant.upsert({
        where: {
          expenseId_userId: {
            expenseId: participant.expenseId,
            userId: participant.userId,
          },
        },
        update: shareFields,
        create: shareFields,
      });
    }
  }

  for (const item of data.packingItems) {
    const fields = {
      workspaceId: item.workspaceId,
      tripId: item.tripId,
      category: item.category,
      name: item.name,
      quantity: item.quantity,
      packed: item.packed,
      assigneeId: item.assigneeId,
      order: item.order,
      version: item.version,
      createdById: item.createdById,
      updatedById: item.updatedById,
      createdAt: dateTime(item.createdAt),
      updatedAt: dateTime(item.updatedAt),
      deletedAt: nullableDateTime(item.deletedAt),
    };
    await tx.packingItem.upsert({
      where: { id: item.id },
      update: fields,
      create: { id: item.id, ...fields },
    });
  }
}
