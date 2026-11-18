import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AddTripParticipantRequestSchema,
  CreateTripRequestSchema,
  DuplicateTripRequestSchema,
  TripListQuerySchema,
  UpdateTripRequestSchema,
  type Trip,
  type TripCover,
  type TripPage,
  type TripParticipant,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { SanitizeService } from "../../common/services/sanitize.service.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import { TripCoverService } from "../media/trip-cover.service.js";
import {
  assertBudgetPair,
  assertDateRange,
  assertOriginCoordinatePair,
  assertTripVisible,
  assertUuid,
  canonicalTripOrigin,
  dateOnlyToDate,
  rawOriginCoordinatePair,
  sortParts,
} from "./content-values.js";
import {
  presentParticipant,
  presentTrip,
} from "./content-presenters.js";
import type { ContentTransaction } from "./content-transaction.js";
import { TripsRepository, type TripCreateData, type TripUpdateData } from "./trips.repository.js";
import { VersionConflictException } from "./version-conflict.exception.js";

type TripRecord = Awaited<ReturnType<TripsRepository["findTrip"]>> & object;

@Injectable()
export class TripsService {
  constructor(
    @Inject(TripsRepository) private readonly repository: TripsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    // Optional only so hand-built instances (existing specs construct three
    // collaborators) keep compiling; `TripsModule` always injects the projector,
    // and without it every trip honestly reports `cover: null`.
    @Inject(TripCoverService) private readonly covers?: TripCoverService,
    @Inject(SanitizeService)
    private readonly sanitizer: SanitizeService = new SanitizeService(),
  ) {}

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawQuery: unknown,
  ): Promise<TripPage> {
    this.permissions.assertCan(membership.role, "trip:read", "trip");
    const query = parseRequest(TripListQuerySchema, rawQuery);
    const { field, direction } = sortParts(
      query.sort,
      ["updatedAt", "createdAt", "startDate", "title"],
      "updatedAt",
    );
    const privateVisibility =
      membership.role === "owner" || membership.role === "admin"
        ? {}
        : {
            OR: [
              { visibility: { in: ["workspace", "public_link"] } },
              { createdById: membership.userId },
            ],
          };
    const where = {
      workspaceId: membership.workspaceId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(query.q
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: query.q, mode: "insensitive" as const } },
                  { summary: { contains: query.q, mode: "insensitive" as const } },
                  { destinations: { has: query.q } },
                  { tags: { has: query.q } },
                ],
              },
            ],
          }
        : {}),
      ...(query.from ? { startDate: { gte: dateOnlyToDate(query.from) } } : {}),
      ...(query.to ? { endDate: { lte: dateOnlyToDate(query.to) } } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.participantId
        ? { participants: { some: { userId: query.participantId } } }
        : {}),
      ...privateVisibility,
    };
    const records = await this.repository.listTrips({
      where,
      orderBy: [{ [field]: direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    const covers = await this.resolveCovers(membership.workspaceId, records);
    return toCursorPage(records, query.limit, (record) =>
      presentTrip(record, covers.get(record.id) ?? null),
    ) as TripPage;
  }

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawInput: unknown,
  ): Promise<Trip> {
    this.permissions.assertCan(membership.role, "trip:create", "trip");
    // Paired-origin coordinates are a business rule, not a shape rule: report them
    // as 422 before the schema turns the pair into a generic 400.
    const rawPair = rawOriginCoordinatePair(rawInput);
    if (rawPair) {
      assertOriginCoordinatePair(rawPair.lat, rawPair.lng);
    }
    const input = parseRequest(CreateTripRequestSchema, rawInput);
    const startDate = dateOnlyToDate(input.startDate);
    const endDate = dateOnlyToDate(input.endDate);
    const budgetAmountMinor = input.budgetAmountMinor ?? null;
    const budgetCurrency = input.budgetCurrency ?? null;
    const originLat = input.originLat ?? null;
    const originLng = input.originLng ?? null;
    assertDateRange(startDate, endDate);
    assertBudgetPair(budgetAmountMinor, budgetCurrency);
    assertOriginCoordinatePair(originLat, originLng);

    const created = await this.repository.transaction(async (tx) => {
      await this.assertMedia(tx, membership.workspaceId, input.coverMediaId ?? null);
      const data: TripCreateData = {
        workspaceId: membership.workspaceId,
        title: input.title,
        summary: input.summary ?? "",
        status: input.status ?? "planning",
        startDate,
        endDate,
        coverMediaId: input.coverMediaId ?? null,
        origin: canonicalTripOrigin(input.origin),
        originLat,
        originLng,
        originCountryCode: input.originCountryCode ?? null,
        timeZone: input.timeZone ?? null,
        destinations: input.destinations ?? [],
        countryCodes: input.countryCodes ?? [],
        tags: input.tags ?? [],
        guestNames: input.guestNames ?? [],
        budgetAmountMinor,
        budgetCurrency,
        visibility: input.visibility ?? "workspace",
        favorite: input.favorite ?? false,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      };
      const record = await this.repository.createTrip(tx, data);
      await this.repository.createParticipant(tx, {
        workspaceId: membership.workspaceId,
        tripId: record.id,
        userId: actor.user.id,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: record.id,
        actorId: actor.user.id,
        verb: "trip.created",
        entityType: "trip",
        entityId: record.id,
        metadata: { status: record.status, visibility: record.visibility },
      });
      return record;
    });

    return this.presentWithCover(membership.workspaceId, created);
  }

  async get(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<Trip> {
    this.permissions.assertCan(membership.role, "trip:read", "trip");
    const trip = await this.requireVisibleTrip(membership, tripId);
    return this.presentWithCover(membership.workspaceId, trip);
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<Trip> {
    this.permissions.assertCan(membership.role, "trip:update", "trip");
    const input = parseRequest(UpdateTripRequestSchema, rawInput);
    const current = await this.requireVisibleTrip(membership, tripId);
    const nextStart = input.startDate ? dateOnlyToDate(input.startDate) : current.startDate;
    const nextEnd = input.endDate ? dateOnlyToDate(input.endDate) : current.endDate;
    const nextBudgetAmount =
      input.budgetAmountMinor !== undefined ? input.budgetAmountMinor : current.budgetAmountMinor;
    const nextBudgetCurrency =
      input.budgetCurrency !== undefined ? input.budgetCurrency : current.budgetCurrency;
    const nextOriginLat =
      input.originLat !== undefined ? input.originLat : (current.originLat ?? null);
    const nextOriginLng =
      input.originLng !== undefined ? input.originLng : (current.originLng ?? null);
    assertDateRange(nextStart, nextEnd);
    assertBudgetPair(nextBudgetAmount, nextBudgetCurrency);
    // The update schema cannot see the stored half of the pair: a patch that sets
    // one coordinate must still merge into a complete location.
    assertOriginCoordinatePair(nextOriginLat, nextOriginLng);

    const data: TripUpdateData = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: nextStart } : {}),
      ...(input.endDate !== undefined ? { endDate: nextEnd } : {}),
      ...(input.coverMediaId !== undefined ? { coverMediaId: input.coverMediaId } : {}),
      ...(input.origin !== undefined ? { origin: canonicalTripOrigin(input.origin) } : {}),
      ...(input.originLat !== undefined ? { originLat: input.originLat } : {}),
      ...(input.originLng !== undefined ? { originLng: input.originLng } : {}),
      ...(input.originCountryCode !== undefined
        ? { originCountryCode: input.originCountryCode }
        : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      ...(input.destinations !== undefined ? { destinations: input.destinations } : {}),
      ...(input.countryCodes !== undefined ? { countryCodes: input.countryCodes } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.guestNames !== undefined ? { guestNames: input.guestNames } : {}),
      ...(input.budgetAmountMinor !== undefined
        ? { budgetAmountMinor: input.budgetAmountMinor }
        : {}),
      ...(input.budgetCurrency !== undefined
        ? { budgetCurrency: input.budgetCurrency }
        : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
      updatedById: actor.user.id,
    };

    const saved = await this.repository.transaction(async (tx) => {
      if (input.coverMediaId !== undefined) {
        await this.assertMedia(tx, membership.workspaceId, input.coverMediaId);
      }
      const count = await this.repository.updateTrip(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        version: input.version,
        data,
      });
      if (count === 0) {
        throw await this.conflict(tx, membership.workspaceId, tripId);
      }
      const updated = await this.repository.findTrip(membership.workspaceId, tripId, tx);
      if (!updated) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "trip.updated",
        entityType: "trip",
        entityId: tripId,
        metadata: { fields: Object.keys(input).filter((field) => field !== "version").sort() },
      });
      return updated;
    });

    return this.presentWithCover(membership.workspaceId, saved);
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "trip:delete", "trip");
    await this.requireVisibleTrip(membership, tripId);

    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDeleteTrip(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
      });
      if (count === 0) {
        throw this.notFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "trip.deleted",
        entityType: "trip",
        entityId: tripId,
        metadata: {},
      });
    });
    return { message: "Trip deleted." };
  }

  async duplicate(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<Trip> {
    this.permissions.assertCan(membership.role, "trip:duplicate", "trip");
    const input = parseRequest(DuplicateTripRequestSchema, rawInput);
    const source = await this.requireVisibleTrip(membership, tripId);

    const duplicated = await this.repository.transaction(async (tx) => {
      const copyTitle = (input.title ?? `${source.title} (Copy)`).slice(0, 160);
      const created = await this.repository.createTrip(tx, {
        workspaceId: membership.workspaceId,
        title: copyTitle,
        summary: source.summary,
        status: "planning",
        startDate: source.startDate,
        endDate: source.endDate,
        coverMediaId: source.coverMediaId,
        origin: source.origin,
        originLat: source.originLat ?? null,
        originLng: source.originLng ?? null,
        originCountryCode: source.originCountryCode ?? null,
        timeZone: source.timeZone ?? null,
        destinations: [...source.destinations],
        countryCodes: [...source.countryCodes],
        tags: [...source.tags],
        guestNames: [...source.guestNames],
        budgetAmountMinor: source.budgetAmountMinor,
        budgetCurrency: source.budgetCurrency,
        visibility: source.visibility,
        favorite: false,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      });
      const children = await this.repository.listDuplicateChildren(
        tx,
        membership.workspaceId,
        tripId,
      );
      await this.repository.createDuplicateChildren(tx, {
        workspaceId: membership.workspaceId,
        tripId: created.id,
        actorId: actor.user.id,
        children: {
          ...children,
          entries: children.entries.map((entry) => ({
            ...entry,
            contentHtml: this.sanitizer.sanitizeHtml(String(entry.contentHtml ?? "")),
          })),
        },
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: created.id,
        actorId: actor.user.id,
        verb: "trip.duplicated",
        entityType: "trip",
        entityId: created.id,
        metadata: { sourceTripId: tripId },
      });
      return created;
    });

    // The copy keeps the source `coverMediaId`, but that asset belongs to the
    // source trip, so the projector reports `cover: null` until a cover is set
    // for the new trip. No borrowed or invented URL is ever returned.
    return this.presentWithCover(membership.workspaceId, duplicated);
  }

  async listParticipants(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<TripParticipant[]> {
    this.permissions.assertCan(membership.role, "participant:read", "participant");
    await this.requireVisibleTrip(membership, tripId);
    const participants = await this.repository.listParticipants(membership.workspaceId, tripId);
    return participants.map(presentParticipant);
  }

  async addParticipant(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<TripParticipant> {
    this.permissions.assertCan(membership.role, "participant:add", "participant");
    const input = parseRequest(AddTripParticipantRequestSchema, rawInput);
    await this.requireVisibleTrip(membership, tripId);

    try {
      return await this.repository.transaction(async (tx) => {
        const targetMember = await this.repository.findWorkspaceMember(
          tx,
          membership.workspaceId,
          input.userId,
        );
        if (!targetMember) {
          throw new BadRequestException({
            code: "INVALID_PARTICIPANT",
            message: "The participant must be an active Workspace member.",
          });
        }
        const participant = await this.repository.createParticipant(tx, {
          workspaceId: membership.workspaceId,
          tripId,
          userId: input.userId,
        });
        await this.activities.record(tx, {
          workspaceId: membership.workspaceId,
          tripId,
          actorId: actor.user.id,
          verb: "participant.added",
          entityType: "participant",
          entityId: participant.id,
          metadata: { userId: input.userId },
        });
        return presentParticipant(participant);
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException({
          code: "PARTICIPANT_EXISTS",
          message: "That member is already a trip participant.",
        });
      }
      throw error;
    }
  }

  async removeParticipant(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    userId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "participant:remove", "participant");
    assertUuid(userId, "userId");
    await this.requireVisibleTrip(membership, tripId);

    await this.repository.transaction(async (tx) => {
      const participant = await this.repository.findParticipant(
        membership.workspaceId,
        tripId,
        userId,
        tx,
      );
      if (!participant) {
        throw new NotFoundException({
          code: "PARTICIPANT_NOT_FOUND",
          message: "Trip participant not found.",
        });
      }
      await this.repository.deleteParticipant(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        userId,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "participant.removed",
        entityType: "participant",
        entityId: participant.id,
        metadata: { userId },
      });
    });
    return { message: "Participant removed." };
  }

  async listActivity(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawQuery: unknown,
  ) {
    const trip = await this.requireVisibleTrip(membership, tripId);
    return this.activities.listTrip(actor, membership, trip, rawQuery);
  }

  private async requireTrip(workspaceId: string, tripId: string): Promise<TripRecord> {
    const trip = await this.repository.findTrip(workspaceId, tripId);
    if (!trip) {
      throw this.notFound();
    }
    return trip;
  }

  private async requireVisibleTrip(
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<TripRecord> {
    const trip = await this.requireTrip(membership.workspaceId, tripId);
    assertTripVisible(membership, trip);
    return trip;
  }

  /** Projects covers for a page of trips with one Workspace-scoped media lookup. */
  private async resolveCovers(
    workspaceId: string,
    records: ReadonlyArray<{ id: string; coverMediaId: string | null }>,
  ): Promise<Map<string, TripCover | null>> {
    if (!this.covers) {
      return new Map(records.map((record) => [record.id, null]));
    }
    return this.covers.resolve(
      records.map((record) => ({ id: record.id, coverMediaId: record.coverMediaId ?? null })),
      (mediaIds) => this.repository.findMediaForCover(workspaceId, mediaIds),
    );
  }

  private async presentWithCover(
    workspaceId: string,
    record: TripRecord,
  ): Promise<Trip> {
    const covers = await this.resolveCovers(workspaceId, [record]);
    return presentTrip(record, covers.get(record.id) ?? null);
  }

  private async assertMedia(
    tx: ContentTransaction,
    workspaceId: string,
    mediaId: string | null,
  ): Promise<void> {
    if (!mediaId) {
      return;
    }
    const media = await this.repository.findMedia(tx, workspaceId, mediaId);
    if (!media) {
      throw new BadRequestException({
        code: "INVALID_COVER_MEDIA",
        message: "The cover media must belong to this Workspace.",
      });
    }
  }

  private async conflict(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
  ): Promise<VersionConflictException> {
    const current = await this.repository.findTrip(workspaceId, tripId, tx);
    if (!current) {
      throw this.notFound();
    }
    return new VersionConflictException(presentTrip(current));
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "TRIP_NOT_FOUND",
      message: "The requested trip was not found.",
    });
  }
}
