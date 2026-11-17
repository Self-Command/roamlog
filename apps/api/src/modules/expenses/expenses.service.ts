import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BudgetSummarySchema,
  CreateExpenseRequestSchema,
  ExpenseListQuerySchema,
  SettleUpResponseSchema,
  UpdateExpenseRequestSchema,
  encodeCursor,
  type BudgetSummary,
  type ExpensePage,
  type ExpenseWithSplits,
  type SettleUpResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import {
  assertDateWithinTrip,
  assertTripVisible,
  dateOnlyToDate,
  sortParts,
} from "../trips/content-values.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import { TripsRepository } from "../trips/trips.repository.js";
import { VersionConflictException } from "../trips/version-conflict.exception.js";
import {
  convertApprox,
  displayTotalOf,
  resolveExpenseShares,
  settleUpByCurrency,
  summarizeCategories,
  summarizeTotals,
} from "./expense-money.js";
import type { ExpenseRecord } from "./expense-records.js";
import { presentExpense } from "./expense.presenter.js";
import { ExpensesRepository } from "./expenses.repository.js";

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(ExpensesRepository) private readonly repository: ExpensesRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
  ) {}

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawQuery: unknown,
  ): Promise<ExpensePage> {
    this.permissions.assertCan(membership.role, "expense:read", "expense");
    await this.requireTrip(membership, tripId);
    const query = parseRequest(ExpenseListQuerySchema, rawQuery);
    const { field, direction } = sortParts(
      query.sort,
      ["date", "createdAt", "amountMinor"],
      "date",
    );
    const records = await this.repository.listExpenses({
      where: {
        workspaceId: membership.workspaceId,
        tripId,
        deletedAt: null,
        ...(query.category ? { category: query.category } : {}),
        ...(query.from ? { date: { gte: dateOnlyToDate(query.from) } } : {}),
        ...(query.to ? { date: { lte: dateOnlyToDate(query.to) } } : {}),
        ...(query.participantId
          ? { participants: { some: { userId: query.participantId } } }
          : {}),
      },
      orderBy: [{ [field]: direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const visible = hasMore ? records.slice(0, query.limit) : records;
    const last = visible.at(-1);
    return {
      items: visible.map(presentExpense),
      nextCursor:
        hasMore && last
          ? encodeCursor({ id: last.id, createdAt: last.createdAt })
          : null,
      hasMore,
    };
  }

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<ExpenseWithSplits> {
    this.permissions.assertCan(membership.role, "expense:create", "expense");
    const input = parseRequest(CreateExpenseRequestSchema, rawInput);
    const trip = await this.requireTrip(membership, tripId);
    const date = dateOnlyToDate(input.date);
    assertDateWithinTrip(date, trip.startDate, trip.endDate);
    await this.assertParticipants(membership.workspaceId, [
      input.paidById,
      ...input.participants.map((participant) => participant.userId),
    ]);
    await this.assertReceipt(membership.workspaceId, tripId, input.receiptMediaId ?? null);
    const shares = resolveExpenseShares({
      amountMinor: input.amountMinor,
      paidById: input.paidById,
      splitMode: input.splitMode,
      participants: input.participants,
    });

    return this.repository.transaction(async (tx) => {
      const created = await this.repository.createExpense(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        date,
        category: input.category,
        note: input.note,
        amountMinor: input.amountMinor,
        currency: input.currency,
        paidById: input.paidById,
        splitMode: input.splitMode,
        receiptMediaId: input.receiptMediaId ?? null,
        createdById: actor.user.id,
      });
      await this.repository.replaceParticipants(tx, {
        workspaceId: membership.workspaceId,
        expenseId: created.id,
        shares,
      });
      await this.recordActivity(tx, membership.workspaceId, tripId, actor.user.id, "expense.created", created.id, {
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
      const record = await this.repository.findExpense(membership.workspaceId, created.id, tx);
      if (!record) {
        throw this.notFound();
      }
      return presentExpense(record);
    });
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    expenseId: string,
    rawInput: unknown,
  ): Promise<ExpenseWithSplits> {
    this.permissions.assertCan(membership.role, "expense:update", "expense");
    const input = parseRequest(UpdateExpenseRequestSchema, rawInput);
    const current = await this.requireExpense(membership.workspaceId, expenseId);
    const trip = await this.requireTrip(membership, current.tripId);
    const date = input.date ? dateOnlyToDate(input.date) : current.date;
    assertDateWithinTrip(date, trip.startDate, trip.endDate);
    await this.assertReceipt(membership.workspaceId, current.tripId, input.receiptMediaId);

    const nextAmount = input.amountMinor ?? current.amountMinor;
    const nextPaidBy = input.paidById ?? current.paidById;
    const nextSplitMode = input.splitMode ?? current.splitMode;
    let shares: Array<{ userId: string; shareAmountMinor: number }> | undefined;

    if (input.participants) {
      await this.assertParticipants(membership.workspaceId, [
        nextPaidBy,
        ...input.participants.map((participant) => participant.userId),
      ]);
      shares = resolveExpenseShares({
        amountMinor: nextAmount,
        paidById: nextPaidBy,
        splitMode: nextSplitMode,
        participants: input.participants,
      });
    } else if (
      input.amountMinor !== undefined ||
      input.paidById !== undefined ||
      input.splitMode !== undefined
    ) {
      if (nextSplitMode === "custom") {
        throw new BadRequestException({
          code: "EXPENSE_SPLIT_SHARES_REQUIRED",
          message: "Custom splits must include participant shares when the amount or payer changes.",
        });
      }
      shares = resolveExpenseShares({
        amountMinor: nextAmount,
        paidById: nextPaidBy,
        splitMode: "equal",
        participants: current.participants.map((participant) => ({
          userId: participant.userId,
        })),
      });
    }

    return this.repository.transaction(async (tx) => {
      const data: Record<string, unknown> = {
        ...(input.date !== undefined ? { date } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.paidById !== undefined ? { paidById: input.paidById } : {}),
        ...(input.splitMode !== undefined ? { splitMode: input.splitMode } : {}),
        ...(input.receiptMediaId !== undefined
          ? { receiptMediaId: input.receiptMediaId }
          : {}),
      };
      const count = await this.repository.updateExpense(tx, {
        workspaceId: membership.workspaceId,
        expenseId,
        version: input.version,
        data,
      });
      if (count === 0) {
        const latest = await this.repository.findExpense(
          membership.workspaceId,
          expenseId,
          tx,
        );
        throw latest ? new VersionConflictException(presentExpense(latest)) : this.notFound();
      }
      if (shares) {
        await this.repository.replaceParticipants(tx, {
          workspaceId: membership.workspaceId,
          expenseId,
          shares,
        });
      }
      await this.recordActivity(
        tx,
        membership.workspaceId,
        current.tripId,
        actor.user.id,
        "expense.updated",
        expenseId,
        { fields: Object.keys(input).filter((key) => key !== "version").sort() },
      );
      const updated = await this.repository.findExpense(
        membership.workspaceId,
        expenseId,
        tx,
      );
      if (!updated) {
        throw this.notFound();
      }
      return presentExpense(updated);
    });
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    expenseId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "expense:delete", "expense");
    const current = await this.requireExpense(membership.workspaceId, expenseId);
    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDeleteExpense(
        tx,
        membership.workspaceId,
        expenseId,
      );
      if (count === 0) {
        throw this.notFound();
      }
      await this.recordActivity(
        tx,
        membership.workspaceId,
        current.tripId,
        actor.user.id,
        "expense.deleted",
        expenseId,
        {},
      );
    });
    return { message: "Expense deleted." };
  }

  async summary(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<BudgetSummary> {
    this.permissions.assertCan(membership.role, "budget:read", "budget");
    const trip = await this.requireTrip(membership, tripId);
    const expenses = await this.repository.listAllExpenses(membership.workspaceId, tripId);
    const displayCurrency =
      trip.budgetCurrency ?? (await this.repository.workspaceDefaultCurrency(membership.workspaceId));
    const originalTotals = summarizeTotals(expenses);
    const displayTotal = displayTotalOf(originalTotals, displayCurrency);
    const budgetInDisplay =
      trip.budgetAmountMinor === null
        ? null
        : trip.budgetCurrency === displayCurrency
          ? trip.budgetAmountMinor
          : convertApprox(trip.budgetAmountMinor, trip.budgetCurrency ?? displayCurrency, displayCurrency);

    return BudgetSummarySchema.parse({
      tripId,
      displayCurrency,
      originalTotals,
      displayTotal,
      categories: summarizeCategories(expenses),
      expenseCount: expenses.length,
      overBudget: budgetInDisplay !== null && displayTotal.amountMinor > budgetInDisplay,
    });
  }

  async settleUp(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<SettleUpResponse> {
    this.permissions.assertCan(membership.role, "budget:settle-up", "budget");
    await this.requireTrip(membership, tripId);
    const expenses = await this.repository.listAllExpenses(membership.workspaceId, tripId);
    return SettleUpResponseSchema.parse({
      tripId,
      suggestions: settleUpByCurrency(expenses.map(presentExpense)),
    });
  }

  private async requireTrip(membership: WorkspaceMembershipAccess, tripId: string) {
    const trip = await this.trips.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw new NotFoundException({
        code: "TRIP_NOT_FOUND",
        message: "The requested trip was not found.",
      });
    }
    assertTripVisible(membership, trip);
    return trip;
  }

  private async requireExpense(
    workspaceId: string,
    expenseId: string,
  ): Promise<ExpenseRecord> {
    const expense = await this.repository.findExpense(workspaceId, expenseId);
    if (!expense) {
      throw this.notFound();
    }
    return expense;
  }

  private async assertParticipants(workspaceId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const active = await this.repository.activeMemberIds(workspaceId, unique);
    const missing = unique.filter((userId) => !active.has(userId));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: "EXPENSE_PARTICIPANT_NOT_MEMBER",
        message: "Every expense participant must be an active Workspace member.",
        errors: missing.map((userId) => ({
          field: "participants",
          code: "EXPENSE_PARTICIPANT_NOT_MEMBER",
          message: `User ${userId} is not an active member.`,
        })),
      });
    }
  }

  private async assertReceipt(
    workspaceId: string,
    tripId: string,
    mediaId: string | null | undefined,
  ): Promise<void> {
    if (!mediaId) {
      return;
    }
    const receipt = await this.repository.findReceipt(workspaceId, mediaId);
    if (!receipt || (receipt.tripId && receipt.tripId !== tripId)) {
      throw new BadRequestException({
        code: "EXPENSE_RECEIPT_INVALID",
        message: "The receipt media must belong to this Workspace and trip.",
      });
    }
  }

  private async recordActivity(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    actorId: string,
    verb: string,
    expenseId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.activities.record(tx, {
      workspaceId,
      tripId,
      actorId,
      verb,
      entityType: "expense",
      entityId: expenseId,
      metadata,
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "EXPENSE_NOT_FOUND",
      message: "The requested expense was not found.",
    });
  }
}
