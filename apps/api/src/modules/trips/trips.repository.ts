import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@roamlog/db";
import type {
  GeoBbox,
  TripStatus,
  TripVisibility,
} from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ContentTransaction } from "./content-transaction.js";
import type {
  ParticipantRecord,
  TripRecord,
} from "./content-records.js";

export interface TripCreateData {
  workspaceId: string;
  title: string;
  summary: string;
  status: TripStatus;
  startDate: Date;
  endDate: Date;
  coverMediaId: string | null;
  origin: string;
  originLat: number | null;
  originLng: number | null;
  originCountryCode: string | null;
  originAddress: string | null;
  originBbox: GeoBbox | null;
  timeZone: string | null;
  destinations: string[];
  countryCodes: string[];
  tags: string[];
  guestNames: string[];
  budgetAmountMinor: number | null;
  budgetCurrency: string | null;
  visibility: TripVisibility;
  favorite: boolean;
  createdById: string;
  updatedById: string;
}

export interface TripUpdateData {
  title?: string;
  summary?: string;
  status?: TripStatus;
  startDate?: Date;
  endDate?: Date;
  coverMediaId?: string | null;
  origin?: string;
  originLat?: number | null;
  originLng?: number | null;
  originCountryCode?: string | null;
  originAddress?: string | null;
  originBbox?: GeoBbox | null;
  timeZone?: string | null;
  destinations?: string[];
  countryCodes?: string[];
  tags?: string[];
  guestNames?: string[];
  budgetAmountMinor?: number | null;
  budgetCurrency?: string | null;
  visibility?: TripVisibility;
  favorite?: boolean;
  updatedById: string;
}

export interface DuplicateChildren {
  stops: Array<Record<string, unknown>>;
  itineraryItems: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown>>;
  participants: Array<{ userId: string }>;
}

/**
 * Converts a contract bounding box into a Prisma `Json` write value.
 *
 * Prisma rejects a bare `null` for a nullable `Json` column; `Prisma.DbNull` is
 * the value that writes SQL NULL. `undefined` stays `undefined` so a partial
 * update leaves the stored box untouched.
 */
function bboxJson(
  value: GeoBbox | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue);
}

/** Same conversion for a create, where the column is always written. */
function bboxJsonRequired(value: GeoBbox | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue);
}

@Injectable()
export class TripsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findTrip(
    workspaceId: string,
    tripId: string,
    tx?: ContentTransaction,
  ): Promise<TripRecord | null> {
    const client = tx ?? this.prisma.client;
    return (await client.trip.findFirst({
      where: {
        id: tripId,
        workspaceId,
        deletedAt: null,
      },
    })) as TripRecord | null;
  }

  async listTrips(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    cursor?: string;
    take: number;
  }): Promise<TripRecord[]> {
    return (await this.prisma.client.trip.findMany({
      where: args.where,
      orderBy: args.orderBy,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as TripRecord[];
  }

  async createTrip(tx: ContentTransaction, data: TripCreateData): Promise<TripRecord> {
    const { originBbox, ...rest } = data;
    return (await tx.trip.create({
      data: { ...rest, originBbox: bboxJsonRequired(originBbox) },
    })) as TripRecord;
  }

  async updateTrip(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      tripId: string;
      version: number;
      data: TripUpdateData;
    },
  ) {
    const { originBbox, ...rest } = args.data;
    const result = await tx.trip.updateMany({
      where: {
        id: args.tripId,
        workspaceId: args.workspaceId,
        version: args.version,
        deletedAt: null,
      },
      data: {
        ...rest,
        ...(originBbox === undefined ? {} : { originBbox: bboxJson(originBbox) }),
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  async softDeleteTrip(
    tx: ContentTransaction,
    args: { workspaceId: string; tripId: string; actorId: string },
  ) {
    const result = await tx.trip.updateMany({
      where: {
        id: args.tripId,
        workspaceId: args.workspaceId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        updatedById: args.actorId,
      },
    });
    return result.count;
  }

  async listParticipants(
    workspaceId: string,
    tripId: string,
    tx?: ContentTransaction,
  ): Promise<ParticipantRecord[]> {
    const client = tx ?? this.prisma.client;
    return (await client.tripParticipant.findMany({
      where: { workspaceId, tripId },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    })) as ParticipantRecord[];
  }

  async findParticipant(
    workspaceId: string,
    tripId: string,
    userId: string,
    tx?: ContentTransaction,
  ): Promise<ParticipantRecord | null> {
    const client = tx ?? this.prisma.client;
    return (await client.tripParticipant.findFirst({
      where: { workspaceId, tripId, userId },
    })) as ParticipantRecord | null;
  }

  async createParticipant(
    tx: ContentTransaction,
    data: { workspaceId: string; tripId: string; userId: string },
  ): Promise<ParticipantRecord> {
    return (await tx.tripParticipant.create({
      data: {
        ...data,
        joinedAt: new Date(),
      },
    })) as ParticipantRecord;
  }

  async deleteParticipant(
    tx: ContentTransaction,
    data: { workspaceId: string; tripId: string; userId: string },
  ): Promise<number> {
    const result = await tx.tripParticipant.deleteMany({ where: data });
    return result.count;
  }

  async findWorkspaceMember(
    tx: ContentTransaction,
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    return tx.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId,
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { id: true },
    });
  }

  async findMedia(
    tx: ContentTransaction,
    workspaceId: string,
    mediaId: string,
  ): Promise<{ id: string } | null> {
    return tx.media.findFirst({
      where: {
        id: mediaId,
        workspaceId,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  /**
   * Cover candidates for a page of trips, scoped to one Workspace.
   *
   * Deliberately returns the raw media rows (status, ownership and dimensions)
   * rather than a boolean: the projector has to verify readiness and trip
   * ownership before any URL is signed.
   */
  async findMediaForCover(
    workspaceId: string,
    mediaIds: readonly string[],
  ): Promise<
    Array<{
      id: string;
      tripId: string | null;
      status: string;
      key: string;
      variants: unknown;
      width: number | null;
      height: number | null;
      blurhash: string | null;
    }>
  > {
    if (mediaIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.client.media.findMany({
      where: {
        id: { in: [...mediaIds] },
        workspaceId,
        deletedAt: null,
      },
      select: {
        id: true,
        tripId: true,
        status: true,
        key: true,
        variants: true,
        width: true,
        height: true,
        blurhash: true,
      },
    });
    return rows as Array<{
      id: string;
      tripId: string | null;
      status: string;
      key: string;
      variants: unknown;
      width: number | null;
      height: number | null;
      blurhash: string | null;
    }>;
  }

  async listDuplicateChildren(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
  ): Promise<DuplicateChildren> {
    const [stops, itineraryItems, entries, participants] = await Promise.all([
      tx.stop.findMany({
        where: { workspaceId, tripId, deletedAt: null },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      }),
      tx.itineraryItem.findMany({
        where: { workspaceId, tripId, deletedAt: null },
        orderBy: [{ date: "asc" }, { order: "asc" }, { id: "asc" }],
      }),
      tx.journalEntry.findMany({
        where: { workspaceId, tripId, deletedAt: null },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      tx.tripParticipant.findMany({
        where: { workspaceId, tripId },
        select: { userId: true },
      }),
    ]);
    return { stops, itineraryItems, entries, participants };
  }

  async createDuplicateChildren(
    tx: ContentTransaction,
    input: {
      workspaceId: string;
      tripId: string;
      actorId: string;
      children: DuplicateChildren;
    },
  ): Promise<void> {
    const { workspaceId, tripId, actorId, children } = input;
    const participantIds = new Set(children.participants.map((row) => row.userId));
    participantIds.add(actorId);

    if (children.stops.length > 0) {
      await tx.stop.createMany({
        data: children.stops.map((stop) => ({
          workspaceId,
          tripId,
          city: String(stop.city),
          country: String(stop.country),
          countryCode: String(stop.countryCode),
          lat: typeof stop.lat === "number" ? stop.lat : null,
          lng: typeof stop.lng === "number" ? stop.lng : null,
          startDate: stop.startDate as Date,
          endDate: stop.endDate as Date,
          notes: String(stop.notes ?? ""),
          order: Number(stop.order ?? 0),
          provider: (stop.provider as string | null) ?? null,
          providerPlaceId: (stop.providerPlaceId as string | null) ?? null,
          timeZone: (stop.timeZone as string | null) ?? null,
          version: 1,
          createdById: actorId,
          updatedById: actorId,
        })),
      });
    }

    if (children.itineraryItems.length > 0) {
      await tx.itineraryItem.createMany({
        data: children.itineraryItems.map((item) => ({
          workspaceId,
          tripId,
          date: item.date as Date,
          startTime: item.startTime as string | null,
          endTime: item.endTime as string | null,
          title: String(item.title),
          type: item.type as "transit" | "food" | "activity" | "stay" | "note",
          location: String(item.location),
          notes: String(item.notes ?? ""),
          done: false,
          order: Number(item.order ?? 0),
          assigneeId: item.assigneeId as string | null,
          version: 1,
          createdById: actorId,
          updatedById: actorId,
        })),
      });
    }

    if (children.entries.length > 0) {
      await tx.journalEntry.createMany({
        data: children.entries.map((entry) => ({
          workspaceId,
          tripId,
          title: String(entry.title),
          date: entry.date as Date,
          location: String(entry.location),
          lat: entry.lat as number | null,
          lng: entry.lng as number | null,
          mood: entry.mood as
            | "calm"
            | "happy"
            | "awe"
            | "tired"
            | "reflective"
            | "excited"
            | null,
          weather: entry.weather as
            | "sunny"
            | "cloudy"
            | "rain"
            | "snow"
            | "wind"
            | "fog"
            | null,
          contentJson: entry.contentJson as object,
          contentHtml: String(entry.contentHtml ?? ""),
          excerpt: String(entry.excerpt ?? ""),
          tags: (entry.tags as string[] | undefined) ?? [],
          favorite: false,
          version: 1,
          createdById: actorId,
          updatedById: actorId,
        })),
      });
    }

    await tx.tripParticipant.createMany({
      data: [...participantIds].map((userId) => ({
        workspaceId,
        tripId,
        userId,
      })),
      skipDuplicates: true,
    });
  }
}
