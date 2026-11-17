import type { ExpenseCategory, SplitMode } from "@roamlog/contracts";

export interface ExpenseParticipantRecord {
  workspaceId: string;
  expenseId: string;
  userId: string;
  shareAmountMinor: number;
}

export interface ExpenseRecord {
  id: string;
  workspaceId: string;
  tripId: string;
  date: Date;
  category: ExpenseCategory;
  note: string;
  amountMinor: number;
  currency: string;
  paidById: string;
  splitMode: SplitMode;
  receiptMediaId: string | null;
  createdById: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  participants: ExpenseParticipantRecord[];
}
