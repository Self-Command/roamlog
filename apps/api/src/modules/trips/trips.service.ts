import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  AddTripParticipantRequestSchema,
  CreateTripRequestSchema,
  DuplicateTripRequestSchema,
  TripListQuerySchema,
  UpdateTripRequestSchema,
  type Trip,
  type TripCover,
  type TripDestinationInput,
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
import { PrismaService } from "../prisma/prisma.service.js";
import {
  assertBudgetPair,
  assertDateRange,
  assertOriginCoordinatePair,
  assertRawBbox,
  assertTripVisible,
  assertUuid,
  canonicalTripOrigin,
  dateOnlyToDate,
  rawOriginCoordinatePair,
  sortParts,
  toBbox,
  type TripAccessContext,
} from "./content-values.js";
import {
  presentParticipant,
  presentTrip,
} from "./content-presenters.js";
import type { ContentTransaction } from "./content-transaction.js";
import { tripVisibilityWhere } from "./trip-access.js";
import {
  TripsRepository,
  type TripCreateData,
  type TripDestinationWriteData,
  type TripUpdateData,
} from "./trips.repository.js";
import { VersionConflictException } from "./version-conflict.exception.js";

type TripRecord = Awaited<ReturnType<TripsRepository["findTrip"]>> & object;

/**
 * Maps request destinations to rows, assigning `order` from the array position.
 *
 * The payload owns the order (the form sends what the person sees); ids are
 * generated on insert, so an edit does not try to reuse ids that were just
 * soft-deleted.
 */
function destinationWriteData(
  tripId: string,
  inputs: readonly TripDestinationInput[],
): TripDestinationWriteData[] {
  return inputs.map((input, index) => ({
    tripId,
    name: input.name,
    provider: input.provider ?? null,
    providerPlaceId: input.providerPlaceId ?? null,
    address: input.address ?? null,
    country: input.country ?? null,
    countryCode: input.countryCode ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    timeZone: input.timeZone ?? null,
    bbox: input.bbox ?? null,
    order: index,
  }));
}

/** Maps stored active rows (duplicate) to insert rows for the copy. */
function destinationCopyData(
  tripId: string,
  rows: NonNullable<TripRecord["destinationsV2"]>,
): TripDestinationWriteData[] {
  return rows.map((row) => ({
    tripId,
    name: row.name,
    provider: row.provider,
    providerPlaceId: row.providerPlaceId,
    address: row.address,
    country: row.country,
    countryCode: row.countryCode,
    lat: row.lat,
    lng: row.lng,
    timeZone: row.timeZone,
    bbox: toBbox(row.bbox),
    order: row.order,
  }));
}

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
    // Optional for the same reason as `covers` (hand-built instances in specs).
    // Production resolves it from the global `PrismaModule`; see
    // `loadAccessContext` for why its absence only narrows access.
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async list(
    actor: AuthenticatedActor,
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
      // The same rule the detail paths call (`assertTripVisible` ->
      // `tripVisibilityWhere`): a `where` fragment, not an owner/admin bypass,
      // so the list cannot show a trip whose detail read 404s — or hide one the
      // detail read admits.
      ...tripVisibilityWhere({
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        platformRole: actor.user.platformRole,
      }),
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
    // A malformed `originBbox` is a business-rule failure: report 422 instead of
    // letting the schema turn it into a generic 400.
    assertRawBbox(rawInput, "originBbox");
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
    const destinationInputs = input.destinationsV2 ?? [];

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
        originAddress: input.originAddress ?? null,
        originBbox: input.originBbox ?? null,
        timeZone: input.timeZone ?? null,
        // Write-through: the deprecated names array mirrors the structured
        // group so search (`destinations: { has }`) and old readers keep
        // working. `destinationsV2` (when sent) is authoritative.
        destinations:
          destinationInputs.length > 0
            ? destinationInputs.map((destination) => destination.name)
            : (input.destinations ?? []),
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
      await this.repository.createDestinations(
        tx,
        destinationWriteData(record.id, destinationInputs),
      );
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
      // Re-read inside the same transaction so the create response carries the
      // rows that were just inserted (the row from `createTrip` has no relation
      // include, and a create that reports `destinationsV2: []` would look lost).
      return (await this.repository.findTrip(membership.workspaceId, record.id, tx)) ?? record;
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
    assertRawBbox(rawInput, "originBbox");
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
      ...(input.originAddress !== undefined ? { originAddress: input.originAddress } : {}),
      ...(input.originBbox !== undefined ? { originBbox: input.originBbox } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      ...(input.destinations !== undefined ? { destinations: input.destinations } : {}),
      // A structured write is authoritative for both representations: the
      // deprecated names array mirrors the rows the same request replaces.
      ...(input.destinationsV2 !== undefined
        ? { destinations: input.destinationsV2.map((destination) => destination.name) }
        : {}),
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
      ...(input.showExactPhotoLocation !== undefined
        ? { showExactPhotoLocation: input.showExactPhotoLocation }
        : {}),
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
      if (input.destinationsV2 !== undefined) {
        // Whole-group replacement in the same transaction as the version bump:
        // either the trip and its route both change, or neither does.
        await this.repository.replaceDestinations(tx, {
          tripId,
          destinations: destinationWriteData(tripId, input.destinationsV2),
        });
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
      // The author's delete cascades to the route so a deleted trip never keeps
      // active destination rows behind.
      await this.repository.softDeleteDestinations(tx, tripId);
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
        originAddress: source.originAddress ?? null,
        // A duplicate copies the address and box so the copy keeps the place the
        // original was planned around; an unreadable stored box is dropped.
        originBbox: toBbox(source.originBbox),
        timeZone: source.timeZone ?? null,
        destinations: [...source.destinations],
        countryCodes: [...source.countryCodes],
        tags: [...source.tags],
        guestNames: [...source.guestNames],
        budgetAmountMinor: source.budgetAmountMinor,
        budgetCurrency: source.budgetCurrency,
        visibility: source.visibility,
        favorite: false,
        // The switch is the Owner's privacy decision, not a per-copy detail: a
        // duplicate that silently reset it to the default would re-expose
        // locations the Owner had turned off.
        showExactPhotoLocation: source.showExactPhotoLocation ?? true,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      });
      // The copy keeps the full route, not just the deprecated names: a
      // duplicated trip must still be mappable. `findTrip` already filtered
      // soft-deleted rows and ordered the group.
      await this.repository.createDestinations(
        tx,
        destinationCopyData(created.id, source.destinationsV2 ?? []),
      );
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
      return (await this.repository.findTrip(membership.workspaceId, created.id, tx)) ?? created;
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
    assertTripVisible(membership, trip, await this.loadAccessContext(membership, tripId));
    return trip;
  }

  /**
   * Loads the two facts the access rule needs but the trip row does not carry:
   * the actor's own participant row and the trip's grants.
   *
   * Both are single indexed lookups for the whole request (not one per trip), so
   * `assertTripVisible` can stay a synchronous pure function. `PrismaService` is
   * optional only so hand-built service instances in specs keep compiling; when
   * it is absent the rule runs without that data, which can only *narrow*
   * access (`custom` then needs creator/super-admin, and an invitee gets
   * nothing) — never widen it. Production always has the global provider.
   */
  private async loadAccessContext(
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<TripAccessContext> {
    const client = this.prisma?.client;
    if (!client) {
      return {};
    }

    const [participation, grants] = await Promise.all([
      client.tripParticipant.findFirst({
        where: { tripId, userId: membership.userId },
        select: { status: true },
      }),
      client.tripAccessGrant.findMany({
        where: { tripId },
        select: { workspaceId: true, userId: true },
      }),
    ]);

    return {
      participation: participation ?? null,
      grants,
    };
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
