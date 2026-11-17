import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateItineraryItemRequestSchema,
  ReorderItineraryRequestSchema,
  UpdateItineraryItemRequestSchema,
  type ItineraryItem,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import {
  assertDateWithinTrip,
  assertTripVisible,
  dateOnlyToDate,
} from "../trips/content-values.js";
import { presentItineraryItem } from "../trips/content-presenters.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import { TripsRepository } from "../trips/trips.repository.js";
import { VersionConflictException } from "../trips/version-conflict.exception.js";
import {
  ItineraryRepository,
  type ItineraryUpdateData,
} from "./itinerary.repository.js";

@Injectable()
export class ItineraryService {
  constructor(
    @Inject(ItineraryRepository) private readonly repository: ItineraryRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
  ) {}

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<ItineraryItem[]> {
    this.permissions.assertCan(membership.role, "itinerary:read", "itinerary");
    await this.requireTrip(membership, tripId);
    const items = await this.repository.listItems(membership.workspaceId, tripId);
    return items.map(presentItineraryItem);
  }

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<ItineraryItem> {
    this.permissions.assertCan(membership.role, "itinerary:create", "itinerary");
    const input = parseRequest(CreateItineraryItemRequestSchema, rawInput);
    const trip = await this.requireTrip(membership, tripId);
    const date = dateOnlyToDate(input.date);
    assertDateWithinTrip(date, trip.startDate, trip.endDate);
    assertTimeRange(input.startTime ?? null, input.endTime ?? null);

    return this.repository.transaction(async (tx) => {
      await this.assertAssignee(tx, membership.workspaceId, input.assigneeId ?? null);
      const max = await this.repository.maxOrder(
        tx,
        membership.workspaceId,
        tripId,
        date,
      );
      const record = await this.repository.createItem(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        date,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        title: input.title,
        type: input.type,
        location: input.location,
        notes: input.notes ?? "",
        done: input.done ?? false,
        order: input.order ?? (max._max.order ?? -1) + 1,
        assigneeId: input.assigneeId ?? null,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "itinerary.created",
        entityType: "itinerary_item",
        entityId: record.id,
        metadata: { date: input.date, type: record.type },
      });
      return presentItineraryItem(record);
    });
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    itemId: string,
    rawInput: unknown,
  ): Promise<ItineraryItem> {
    this.permissions.assertCan(membership.role, "itinerary:update", "itinerary");
    const input = parseRequest(UpdateItineraryItemRequestSchema, rawInput);
    const current = await this.repository.findItem(membership.workspaceId, itemId);
    if (!current) {
      throw this.notFound();
    }
    const trip = await this.requireTrip(membership, current.tripId);
    const nextDate = input.date ? dateOnlyToDate(input.date) : current.date;
    const nextStart =
      input.startTime !== undefined ? input.startTime : current.startTime;
    const nextEnd = input.endTime !== undefined ? input.endTime : current.endTime;
    assertDateWithinTrip(nextDate, trip.startDate, trip.endDate);
    assertTimeRange(nextStart, nextEnd);

    const data: ItineraryUpdateData = {
      ...(input.date !== undefined ? { date: nextDate } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.done !== undefined ? { done: input.done } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      updatedById: actor.user.id,
    };

    return this.repository.transaction(async (tx) => {
      if (input.assigneeId !== undefined) {
        await this.assertAssignee(tx, membership.workspaceId, input.assigneeId);
      }
      const count = await this.repository.updateItem(tx, {
        workspaceId: membership.workspaceId,
        itemId,
        version: input.version,
        data,
      });
      if (count === 0) {
        const latest = await this.repository.findItem(membership.workspaceId, itemId, tx);
        throw latest
          ? new VersionConflictException(presentItineraryItem(latest))
          : this.notFound();
      }
      const updated = await this.repository.findItem(membership.workspaceId, itemId, tx);
      if (!updated) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: updated.tripId,
        actorId: actor.user.id,
        verb: "itinerary.updated",
        entityType: "itinerary_item",
        entityId: itemId,
        metadata: { fields: Object.keys(input).filter((field) => field !== "version").sort() },
      });
      return presentItineraryItem(updated);
    });
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    itemId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "itinerary:delete", "itinerary");
    const current = await this.repository.findItem(membership.workspaceId, itemId);
    if (!current) {
      throw this.notFound();
    }

    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDeleteItem(tx, {
        workspaceId: membership.workspaceId,
        itemId,
        actorId: actor.user.id,
      });
      if (count === 0) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: current.tripId,
        actorId: actor.user.id,
        verb: "itinerary.deleted",
        entityType: "itinerary_item",
        entityId: itemId,
        metadata: {},
      });
    });
    return { message: "Itinerary item deleted." };
  }

  async reorder(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<ItineraryItem[]> {
    this.permissions.assertCan(membership.role, "itinerary:reorder", "itinerary");
    const input = parseRequest(ReorderItineraryRequestSchema, rawInput);
    const ids = input.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: "DUPLICATE_REORDER_ITEM",
        message: "A reorder request cannot contain the same item twice.",
      });
    }

    return this.repository.transaction(async (tx) => {
      await this.requireTripInTransaction(tx, membership, tripId);
      const existing = await this.repository.findItemsByIds(
        tx,
        membership.workspaceId,
        tripId,
        ids,
      );
      if (existing.length !== ids.length) {
        throw new NotFoundException({
          code: "ITINERARY_ITEM_NOT_FOUND",
          message: "Every itinerary item must belong to this trip.",
        });
      }
      const reordered = await this.repository.setOrders(
        tx,
        membership.workspaceId,
        tripId,
        input.items,
      );
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "itinerary.reordered",
        entityType: "trip",
        entityId: tripId,
        metadata: { itemIds: ids },
      });
      return reordered.map(presentItineraryItem);
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

  private async requireTripInTransaction(
    tx: ContentTransaction,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ) {
    const trip = await this.trips.findTrip(membership.workspaceId, tripId, tx);
    if (!trip) {
      throw new NotFoundException({
        code: "TRIP_NOT_FOUND",
        message: "The requested trip was not found.",
      });
    }
    assertTripVisible(membership, trip);
    return trip;
  }

  private async assertAssignee(
    tx: ContentTransaction,
    workspaceId: string,
    assigneeId: string | null,
  ): Promise<void> {
    if (!assigneeId) {
      return;
    }
    const member = await this.repository.findWorkspaceMember(tx, workspaceId, assigneeId);
    if (!member) {
      throw new BadRequestException({
        code: "INVALID_ASSIGNEE",
        message: "The assignee must be an active Workspace member.",
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "ITINERARY_ITEM_NOT_FOUND",
      message: "The requested itinerary item was not found.",
    });
  }
}

function assertTimeRange(start: string | null, end: string | null): void {
  if (start && end && end < start) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "endTime must be on or after startTime.",
      errors: [{ field: "endTime", code: "INVALID_TIME_RANGE", message: "Invalid time range." }],
    });
  }
}
