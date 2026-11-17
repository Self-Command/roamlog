import { Inject, Injectable } from "@nestjs/common";
import type { ExpenseCategory, SplitMode } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import type { ExpenseRecord } from "./expense-records.js";

export interface ExpenseCreateData {
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
}

@Injectable()
export class ExpensesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findExpense(
    workspaceId: string,
    expenseId: string,
    tx?: ContentTransaction,
  ): Promise<ExpenseRecord | null> {
    const client = tx ?? this.prisma.client;
    return (await client.expense.findFirst({
      where: {
        id: expenseId,
        workspaceId,
        deletedAt: null,
        trip: { deletedAt: null },
      },
      include: { participants: true },
    })) as ExpenseRecord | null;
  }

  async listExpenses(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    cursor?: string;
    take: number;
  }): Promise<ExpenseRecord[]> {
    return (await this.prisma.client.expense.findMany({
      where: args.where as never,
      orderBy: args.orderBy as never,
      include: { participants: true },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as ExpenseRecord[];
  }

  async listAllExpenses(workspaceId: string, tripId: string): Promise<ExpenseRecord[]> {
    return (await this.prisma.client.expense.findMany({
      where: { workspaceId, tripId, deletedAt: null },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      include: { participants: true },
    })) as ExpenseRecord[];
  }

  async createExpense(
    tx: ContentTransaction,
    data: ExpenseCreateData,
  ): Promise<ExpenseRecord> {
    return (await tx.expense.create({
      data: {
        ...data,
        participants: { create: [] },
      },
      include: { participants: true },
    })) as ExpenseRecord;
  }

  async replaceParticipants(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      expenseId: string;
      shares: Array<{ userId: string; shareAmountMinor: number }>;
    },
  ): Promise<void> {
    await tx.expenseParticipant.deleteMany({ where: { expenseId: args.expenseId } });
    if (args.shares.length === 0) {
      return;
    }
    await tx.expenseParticipant.createMany({
      data: args.shares.map((share) => ({
        workspaceId: args.workspaceId,
        expenseId: args.expenseId,
        userId: share.userId,
        shareAmountMinor: share.shareAmountMinor,
      })),
    });
  }

  async updateExpense(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      expenseId: string;
      version: number;
      data: Record<string, unknown>;
    },
  ): Promise<number> {
    const result = await tx.expense.updateMany({
      where: {
        id: args.expenseId,
        workspaceId: args.workspaceId,
        version: args.version,
        deletedAt: null,
      },
      data: { ...(args.data as Record<string, unknown>), version: { increment: 1 }, updatedAt: new Date() } as never,
    });
    return result.count;
  }

  async softDeleteExpense(
    tx: ContentTransaction,
    workspaceId: string,
    expenseId: string,
  ): Promise<number> {
    const result = await tx.expense.updateMany({
      where: { id: expenseId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });
    return result.count;
  }

  async activeMemberIds(workspaceId: string, userIds: readonly string[]): Promise<Set<string>> {
    const members = await this.prisma.client.workspaceMember.findMany({
      where: {
        workspaceId,
        userId: { in: [...userIds] },
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { userId: true },
    });
    return new Set(members.map((member) => member.userId));
  }

  async workspaceDefaultCurrency(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.client.workspace.findUnique({
      where: { id: workspaceId },
      select: { defaultCurrency: true },
    });
    return workspace?.defaultCurrency ?? "USD";
  }

  async findReceipt(
    workspaceId: string,
    mediaId: string,
  ): Promise<{ id: string; tripId: string | null; status: string } | null> {
    return this.prisma.client.media.findFirst({
      where: { id: mediaId, workspaceId, deletedAt: null },
      select: { id: true, tripId: true, status: true },
    });
  }
}
