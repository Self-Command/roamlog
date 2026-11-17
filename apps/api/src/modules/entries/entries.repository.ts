import { Inject, Injectable } from "@nestjs/common";
import type { Mood, Weather } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { EntryRecord, RevisionRecord } from "../trips/content-records.js";
import type { ContentTransaction } from "../trips/content-transaction.js";

export interface EntryCreateData {
  workspaceId: string;
  tripId: string;
  title: string;
  date: Date;
  location: string;
  lat: number | null;
  lng: number | null;
  mood: Mood | null;
  weather: Weather | null;
  contentJson: object;
  contentHtml: string;
  excerpt: string;
  tags: string[];
  favorite: boolean;
  createdById: string;
  updatedById: string;
}

export interface EntryUpdateData {
  title?: string;
  date?: Date;
  location?: string;
  lat?: number | null;
  lng?: number | null;
  mood?: Mood | null;
  weather?: Weather | null;
  contentJson?: object;
  contentHtml?: string;
  excerpt?: string;
  tags?: string[];
  favorite?: boolean;
  updatedById: string;
}

export interface RevisionCreateData {
  workspaceId: string;
  entryId: string;
  version: number;
  title: string;
  contentJson: object;
  contentHtml: string;
  editedById: string;
}

@Injectable()
export class EntriesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async listEntries(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    cursor?: string;
    take: number;
  }): Promise<EntryRecord[]> {
    return (await this.prisma.client.journalEntry.findMany({
      where: args.where as never,
      orderBy: args.orderBy as never,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as EntryRecord[];
  }

  async findEntry(
    workspaceId: string,
    entryId: string,
    tx?: ContentTransaction,
  ): Promise<EntryRecord | null> {
    return (await (tx ?? this.prisma.client).journalEntry.findFirst({
      where: {
        id: entryId,
        workspaceId,
        deletedAt: null,
        trip: { deletedAt: null },
      },
    })) as EntryRecord | null;
  }

  async createEntry(tx: ContentTransaction, data: EntryCreateData): Promise<EntryRecord> {
    return (await tx.journalEntry.create({ data })) as EntryRecord;
  }

  async updateEntry(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      entryId: string;
      version: number;
      data: EntryUpdateData;
    },
  ) {
    const result = await tx.journalEntry.updateMany({
      where: {
        id: args.entryId,
        workspaceId: args.workspaceId,
        version: args.version,
        deletedAt: null,
        trip: { deletedAt: null },
      },
      data: {
        ...args.data,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  async setFavorite(
    tx: ContentTransaction,
    args: { entryId: string; favorite: boolean; actorId: string },
  ): Promise<EntryRecord> {
    return (await tx.journalEntry.update({
      where: { id: args.entryId },
      data: {
        favorite: args.favorite,
        updatedById: args.actorId,
        version: { increment: 1 },
      },
    })) as EntryRecord;
  }

  async softDeleteEntry(
    tx: ContentTransaction,
    args: { workspaceId: string; entryId: string; actorId: string },
  ) {
    const result = await tx.journalEntry.updateMany({
      where: {
        id: args.entryId,
        workspaceId: args.workspaceId,
        deletedAt: null,
      },
      data: { deletedAt: new Date(), updatedById: args.actorId },
    });
    return result.count;
  }

  async createRevision(
    tx: ContentTransaction,
    data: RevisionCreateData,
  ): Promise<RevisionRecord> {
    return (await tx.entryRevision.create({ data })) as RevisionRecord;
  }

  async listRevisions(
    workspaceId: string,
    entryId: string,
    tx?: ContentTransaction,
  ): Promise<RevisionRecord[]> {
    return (await (tx ?? this.prisma.client).entryRevision.findMany({
      where: { workspaceId, entryId },
      orderBy: [{ version: "desc" }, { id: "desc" }],
    })) as RevisionRecord[];
  }

  async findRevision(
    workspaceId: string,
    entryId: string,
    revisionId: string,
    tx?: ContentTransaction,
  ): Promise<RevisionRecord | null> {
    return (await (tx ?? this.prisma.client).entryRevision.findFirst({
      where: { id: revisionId, workspaceId, entryId },
    })) as RevisionRecord | null;
  }

  async trimRevisions(
    tx: ContentTransaction,
    entryId: string,
    workspaceId: string,
    keep: number,
  ): Promise<number> {
    const stale = await tx.entryRevision.findMany({
      where: { workspaceId, entryId },
      orderBy: [{ version: "desc" }, { id: "desc" }],
      skip: keep,
      select: { id: true },
    });
    if (stale.length === 0) {
      return 0;
    }
    const result = await tx.entryRevision.deleteMany({
      where: {
        workspaceId,
        entryId,
        id: { in: stale.map((revision) => revision.id) },
      },
    });
    return result.count;
  }
}
