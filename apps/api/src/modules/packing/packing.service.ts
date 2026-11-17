import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BulkPackingRequestSchema,
  CreatePackingItemRequestSchema,
  PackingListQuerySchema,
  ReorderPackingRequestSchema,
  UpdatePackingItemRequestSchema,
  encodeCursor,
  type BulkPackingResponse,
  type PackingItem,
  type PackingPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import { assertTripVisible, sortParts } from "../trips/content-values.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import { TripsRepository } from "../trips/trips.repository.js";
import { VersionConflictException } from "../trips/version-conflict.exception.js";
import { nextPackingOrder, normalizeReorder } from "./packing-order.js";
import type { PackingItemRecord } from "./packing-records.js";
import { presentPackingItem } from "./packing.presenter.js";
import { PackingRepository } from "./packing.repository.js";

@Injectable()
export class PackingService {
  constructor(
    @Inject(PackingRepository) private readonly repository: PackingRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
  ) {}

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawQuery: unknown,
  ): Promise<PackingPage> {
    this.permissions.assertCan(membership.role, "packing:read", "packing");
    await this.requireTrip(membership, tripId);
    const query = parseRequest(PackingListQuerySchema, rawQuery);
    const { field, direction } = sortParts(query.sort, ["order", "createdAt", "name"], "order");
    const records = await this.repository.listItems({
      where: {
        workspaceId: membership.workspaceId,
        tripId,
        deletedAt: null,
        ...(query.category ? { category: query.category } : {}),
        ...(query.packed !== undefined ? { packed: query.packed } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      },
      orderBy: [{ [field]: field === "order" ? "asc" : direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const visible = hasMore ? records.slice(0, query.limit) : records;
    const last = visible.at(-1);
    return {
      items: visible.map(presentPackingItem),
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
  ): Promise<PackingItem> {
    this.permissions.assertCan(membership.role, "packing:create", "packing");
    await this.requireTrip(membership, tripId);
    const input = parseRequest(CreatePackingItemRequestSchema, rawInput);
    await this.assertAssignee(membership.workspaceId, input.assigneeId ?? null);

    return this.repository.transaction(async (tx) => {
      const maxOrder = await this.currentMaxOrder(tx, membership.workspaceId, tripId);
      const record = await this.repository.createItem(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        category: input.category,
        name: input.name,
        quantity: input.quantity ?? 1,
        assigneeId: input.assigneeId ?? null,
        order: input.order ?? nextPackingOrder(maxOrder),
        createdById: actor.user.id,
        updatedById: actor.user.id,
      });
      await this.recordActivity(
        tx,
        membership.workspaceId,
        tripId,
        actor.user.id,
        "packing.created",
        record.id,
      );
      return presentPackingItem(record);
    });
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    itemId: string,
    rawInput: unknown,
  ): Promise<PackingItem> {
    this.permissions.assertCan(membership.role, "packing:update", "packing");
    const input = parseRequest(UpdatePackingItemRequestSchema, rawInput);
    const current = await this.requireItem(membership.workspaceId, itemId);
    await this.assertAssignee(membership.workspaceId, input.assigneeId);

    return this.repository.transaction(async (tx) => {
      const data: Record<string, unknown> = {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.packed !== undefined ? { packed: input.packed } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        updatedById: actor.user.id,
      };
      const count = await this.repository.updateItem(tx, {
        workspaceId: membership.workspaceId,
        itemId,
        version: input.version,
        data,
      });
      if (count === 0) {
        const latest = await this.repository.findItem(membership.workspaceId, itemId, tx);
        throw latest ? new VersionConflictException(presentPackingItem(latest)) : this.notFound();
      }
      await this.recordActivity(
        tx,
        membership.workspaceId,
        current.tripId,
        actor.user.id,
        "packing.updated",
        itemId,
      );
      const updated = await this.repository.findItem(membership.workspaceId, itemId, tx);
      if (!updated) {
        throw this.notFound();
      }
      return presentPackingItem(updated);
    });
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    itemId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "packing:delete", "packing");
    const current = await this.requireItem(membership.workspaceId, itemId);
    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDeleteItem(
        tx,
        membership.workspaceId,
        itemId,
        actor.user.id,
      );
      if (count === 0) {
        throw this.notFound();
      }
      await this.recordActivity(
        tx,
        membership.workspaceId,
        current.tripId,
        actor.user.id,
        "packing.deleted",
        itemId,
      );
    });
    return { message: "Packing item deleted." };
  }

  async reorder(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<PackingItem[]> {
    this.permissions.assertCan(membership.role, "packing:reorder", "packing");
    await this.requireTrip(membership, tripId);
    const input = parseRequest(ReorderPackingRequestSchema, rawInput);
    const normalized = normalizeReorder(input.items);
    const existing = await this.repository.listAll(membership.workspaceId, tripId);
    const existingIds = new Set(existing.map((item) => item.id));
    for (const item of normalized) {
      if (!existingIds.has(item.id)) {
        throw new BadRequestException({
          code: "PACKING_ITEM_NOT_IN_TRIP",
          message: "Every reordered item must belong to this trip.",
        });
      }
    }

    return this.repository.transaction(async (tx) => {
      for (const item of normalized) {
        await this.repository.setOrder(tx, membership.workspaceId, item.id, item.order);
      }
      const all = await this.repository.listAll(membership.workspaceId, tripId, tx);
      const ordered = [...all].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      for (const [index, item] of ordered.entries()) {
        if (item.order !== index) {
          await this.repository.setOrder(tx, membership.workspaceId, item.id, index);
        }
      }
      const finalItems = await this.repository.listAll(membership.workspaceId, tripId, tx);
      await this.recordActivity(
        tx,
        membership.workspaceId,
        tripId,
        actor.user.id,
        "packing.reordered",
        tripId,
      );
      return finalItems.map(presentPackingItem);
    });
  }

  async bulk(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<BulkPackingResponse> {
    this.permissions.assertCan(membership.role, "packing:bulk", "packing");
    await this.requireTrip(membership, tripId);
    const input = parseRequest(BulkPackingRequestSchema, rawInput);
    for (const update of input.update ?? []) {
      await this.assertAssignee(membership.workspaceId, update.assigneeId);
    }
    for (const create of input.create ?? []) {
      await this.assertAssignee(membership.workspaceId, create.assigneeId ?? null);
    }

    return this.repository.transaction(async (tx) => {
      let maxOrder = await this.currentMaxOrder(tx, membership.workspaceId, tripId);
      for (const create of input.create ?? []) {
        maxOrder =
          create.order ??
          nextPackingOrder(maxOrder);
        await this.repository.createItem(tx, {
          workspaceId: membership.workspaceId,
          tripId,
          category: create.category,
          name: create.name,
          quantity: create.quantity ?? 1,
          assigneeId: create.assigneeId ?? null,
          order: maxOrder,
          createdById: actor.user.id,
          updatedById: actor.user.id,
        });
      }
      for (const update of input.update ?? []) {
        const current = await this.repository.findItem(
          membership.workspaceId,
          update.id,
          tx,
        );
        if (!current || current.tripId !== tripId) {
          throw this.notFound();
        }
        const count = await this.repository.updateItem(tx, {
          workspaceId: membership.workspaceId,
          itemId: update.id,
          version: update.version,
          data: {
            ...(update.category !== undefined ? { category: update.category } : {}),
            ...(update.name !== undefined ? { name: update.name } : {}),
            ...(update.quantity !== undefined ? { quantity: update.quantity } : {}),
            ...(update.packed !== undefined ? { packed: update.packed } : {}),
            ...(update.assigneeId !== undefined ? { assigneeId: update.assigneeId } : {}),
            ...(update.order !== undefined ? { order: update.order } : {}),
            updatedById: actor.user.id,
          },
        });
        if (count === 0) {
          const latest = await this.repository.findItem(
            membership.workspaceId,
            update.id,
            tx,
          );
          throw latest
            ? new VersionConflictException(presentPackingItem(latest))
            : this.notFound();
        }
      }
      for (const itemId of input.deleteIds ?? []) {
        const count = await this.repository.softDeleteItem(
          tx,
          membership.workspaceId,
          itemId,
          actor.user.id,
        );
        if (count === 0) {
          throw this.notFound();
        }
      }
      await this.recordActivity(
        tx,
        membership.workspaceId,
        tripId,
        actor.user.id,
        "packing.bulk_updated",
        tripId,
        {
          created: input.create?.length ?? 0,
          updated: input.update?.length ?? 0,
          deleted: input.deleteIds?.length ?? 0,
        },
      );
      const items = await this.repository.listAll(membership.workspaceId, tripId, tx);
      return { items: items.map(presentPackingItem) };
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

  private async requireItem(workspaceId: string, itemId: string): Promise<PackingItemRecord> {
    const item = await this.repository.findItem(workspaceId, itemId);
    if (!item) {
      throw this.notFound();
    }
    return item;
  }

  private async assertAssignee(
    workspaceId: string,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) {
      return;
    }
    const active = await this.repository.activeMemberIds(workspaceId, [assigneeId]);
    if (!active.has(assigneeId)) {
      throw new BadRequestException({
        code: "PACKING_ASSIGNEE_NOT_MEMBER",
        message: "The packing assignee must be an active Workspace member.",
      });
    }
  }

  private async currentMaxOrder(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
  ): Promise<number | null> {
    const result = await tx.packingItem.aggregate({
      where: { workspaceId, tripId, deletedAt: null },
      _max: { order: true },
    });
    return result._max.order;
  }

  private async recordActivity(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    actorId: string,
    verb: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.activities.record(tx, {
      workspaceId,
      tripId,
      actorId,
      verb,
      entityType: "packing_item",
      entityId,
      metadata,
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "PACKING_ITEM_NOT_FOUND",
      message: "The requested packing item was not found.",
    });
  }
}
