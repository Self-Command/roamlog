import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { TripRecord } from "../trips/content-records.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import type { MediaRecord } from "./media-records.js";

export interface MediaCreateData {
  id: string;
  workspaceId: string;
  tripId: string | null;
  uploaderId: string;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  date: Date | null;
  location: string | null;
  status: "pending";
  variants: Record<string, unknown>;
}

@Injectable()
export class MediaRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findMedia(
    workspaceId: string,
    mediaId: string,
    tx?: ContentTransaction,
  ): Promise<MediaRecord | null> {
    const client = tx ?? this.prisma.client;
    return (await client.media.findFirst({
      where: { id: mediaId, workspaceId, deletedAt: null },
    })) as MediaRecord | null;
  }

  async createMedia(data: MediaCreateData): Promise<MediaRecord> {
    return (await this.prisma.client.media.create({ data: data as never })) as MediaRecord;
  }

  async listMedia(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    cursor?: string;
    take: number;
  }): Promise<MediaRecord[]> {
    return (await this.prisma.client.media.findMany({
      where: args.where as never,
      orderBy: args.orderBy as never,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as MediaRecord[];
  }

  async updateMedia(
    workspaceId: string,
    mediaId: string,
    data: Record<string, unknown>,
  ): Promise<MediaRecord> {
    return (await this.prisma.client.media.update({
      where: { id: mediaId, workspaceId },
      data: data as never,
    })) as MediaRecord;
  }

  async softDelete(
    tx: ContentTransaction,
    workspaceId: string,
    mediaId: string,
  ): Promise<number> {
    const result = await tx.media.updateMany({
      where: { id: mediaId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), status: "failed", error: "Media deleted." },
    });
    return result.count;
  }

  async detachFromContent(
    tx: ContentTransaction,
    workspaceId: string,
    mediaId: string,
  ): Promise<void> {
    await tx.entryMedia.deleteMany({ where: { mediaId } });
    await tx.trip.updateMany({
      where: { workspaceId, coverMediaId: mediaId },
      data: { coverMediaId: null, updatedAt: new Date() },
    });
    await tx.workspace.updateMany({
      where: { id: workspaceId, logoMediaId: mediaId },
      data: { logoMediaId: null, updatedAt: new Date() },
    });
  }

  async setTripCover(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    mediaId: string,
    actorId: string,
  ): Promise<TripRecord | null> {
    const result = await tx.trip.updateMany({
      where: { id: tripId, workspaceId, deletedAt: null },
      data: {
        coverMediaId: mediaId,
        updatedById: actorId,
        updatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      return null;
    }
    return (await tx.trip.findFirst({
      where: { id: tripId, workspaceId, deletedAt: null },
    })) as TripRecord | null;
  }
}
