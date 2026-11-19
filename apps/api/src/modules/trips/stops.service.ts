import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CreateStopRequestSchema,
  ReorderStopsRequestSchema,
  UpdateStopRequestSchema,
  type Stop,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import {
  assertDateRange,
  assertDateWithinTrip,
  assertRawBbox,
  assertRawProvider,
  assertTripVisible,
  dateOnlyToDate,
} from "./content-values.js";
import { presentStop } from "./content-presenters.js";
import type { ContentTransaction } from "./content-transaction.js";
import { StopsRepository, type StopUpdateData } from "./stops.repository.js";
import { VersionConflictException } from "./version-conflict.exception.js";

@Injectable()
export class StopsService {
  constructor(
    @Inject(StopsRepository) private readonly repository: StopsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
  ) {}

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<Stop[]> {
    this.permissions.assertCan(membership.role, "stop:read", "stop");
    await this.requireTrip(membership, tripId);
    const stops = await this.repository.listStops(membership.workspaceId, tripId);
    return stops.map(presentStop);
  }

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<Stop> {
    this.permissions.assertCan(membership.role, "stop:create", "stop");
    // The box and source are checked on the raw body so a bad value is `422`
    // instead of the schema's generic 400.
    assertRawBbox(rawInput, "bbox");
    assertRawProvider(rawInput, "provider");
    const input = parseRequest(CreateStopRequestSchema, rawInput);
    const startDate = dateOnlyToDate(input.startDate);
    const endDate = dateOnlyToDate(input.endDate);
    assertDateRange(startDate, endDate);

    return this.repository.transaction(async (tx) => {
      const trip = await this.requireActiveTrip(tx, membership, tripId);
      assertDateWithinTrip(startDate, trip.startDate, trip.endDate, "startDate");
      assertDateWithinTrip(endDate, trip.startDate, trip.endDate, "endDate");
      const max = await this.repository.maxOrder(tx, membership.workspaceId, tripId);
      const record = await this.repository.createStop(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        city: input.city,
        country: input.country,
        countryCode: input.countryCode,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        startDate,
        endDate,
        notes: input.notes ?? "",
        order: input.order ?? (max._max.order ?? -1) + 1,
        provider: input.provider ?? null,
        providerPlaceId: input.providerPlaceId ?? null,
        timeZone: input.timeZone ?? null,
        address: input.address ?? null,
        bbox: input.bbox ?? null,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "stop.created",
        entityType: "stop",
        entityId: record.id,
        metadata: { city: record.city },
      });
      return presentStop(record);
    });
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    stopId: string,
    rawInput: unknown,
  ): Promise<Stop> {
    this.permissions.assertCan(membership.role, "stop:update", "stop");
    assertRawBbox(rawInput, "bbox");
    assertRawProvider(rawInput, "provider");
    const input = parseRequest(UpdateStopRequestSchema, rawInput);
    const current = await this.repository.findStop(membership.workspaceId, stopId);
    if (!current) {
      throw this.notFound();
    }
    const nextStart = input.startDate ? dateOnlyToDate(input.startDate) : current.startDate;
    const nextEnd = input.endDate ? dateOnlyToDate(input.endDate) : current.endDate;
    assertDateRange(nextStart, nextEnd);

    const data: StopUpdateData = {
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(input.startDate !== undefined ? { startDate: nextStart } : {}),
      ...(input.endDate !== undefined ? { endDate: nextEnd } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.providerPlaceId !== undefined ? { providerPlaceId: input.providerPlaceId } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.bbox !== undefined ? { bbox: input.bbox } : {}),
      updatedById: actor.user.id,
    };

    return this.repository.transaction(async (tx) => {
      const trip = await this.requireActiveTrip(tx, membership, current.tripId);
      assertDateWithinTrip(nextStart, trip.startDate, trip.endDate, "startDate");
      assertDateWithinTrip(nextEnd, trip.startDate, trip.endDate, "endDate");
      const count = await this.repository.updateStop(tx, {
        workspaceId: membership.workspaceId,
        stopId,
        version: input.version,
        data,
      });
      if (count === 0) {
        const latest = await this.repository.findStop(membership.workspaceId, stopId, tx);
        throw latest ? new VersionConflictException(presentStop(latest)) : this.notFound();
      }
      const updated = await this.repository.findStop(membership.workspaceId, stopId, tx);
      if (!updated) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: updated.tripId,
        actorId: actor.user.id,
        verb: "stop.updated",
        entityType: "stop",
        entityId: stopId,
        metadata: { fields: Object.keys(input).filter((field) => field !== "version").sort() },
      });
      return presentStop(updated);
    });
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    stopId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "stop:delete", "stop");
    const current = await this.repository.findStop(membership.workspaceId, stopId);
    if (!current) {
      throw this.notFound();
    }

    await this.repository.transaction(async (tx) => {
      await this.requireActiveTrip(tx, membership, current.tripId);
      const count = await this.repository.softDeleteStop(tx, {
        workspaceId: membership.workspaceId,
        stopId,
        actorId: actor.user.id,
      });
      if (count === 0) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: current.tripId,
        actorId: actor.user.id,
        verb: "stop.deleted",
        entityType: "stop",
        entityId: stopId,
        metadata: {},
      });
    });
    return { message: "Stop deleted." };
  }

  async reorder(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<Stop[]> {
    this.permissions.assertCan(membership.role, "stop:reorder", "stop");
    const input = parseRequest(ReorderStopsRequestSchema, rawInput);
    const ids = input.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        code: "DUPLICATE_REORDER_ITEM",
        message: "A reorder request cannot contain the same stop twice.",
      });
    }

    return this.repository.transaction(async (tx) => {
      await this.requireActiveTrip(tx, membership, tripId);
      const existing = await this.repository.findStopsByIds(
        tx,
        membership.workspaceId,
        tripId,
        ids,
      );
      if (existing.length !== ids.length) {
        throw new BadRequestException({
          code: "INVALID_REORDER_ITEMS",
          message: "Every stop must belong to this trip and Workspace.",
        });
      }
      const reordered = await this.repository.setOrders(
        tx,
        membership.workspaceId,
        tripId,
        actor.user.id,
        input.items,
      );
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "stop.reordered",
        entityType: "trip",
        entityId: tripId,
        metadata: { itemIds: ids },
      });
      return reordered.map(presentStop);
    });
  }

  private async requireTrip(membership: WorkspaceMembershipAccess, tripId: string) {
    const trip = await this.repository.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw this.notFound();
    }
    assertTripVisible(membership, trip);
    return trip;
  }

  private async requireActiveTrip(
    tx: ContentTransaction,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ) {
    const trip = await this.repository.findTrip(membership.workspaceId, tripId, tx);
    if (!trip) {
      throw this.notFound();
    }
    assertTripVisible(membership, trip);
    return trip;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "STOP_NOT_FOUND",
      message: "The requested stop was not found.",
    });
  }
}
