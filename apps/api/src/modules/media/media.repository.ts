import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { TripRecord } from "../trips/content-records.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import type { MediaMotionRecord, MediaRecord } from "./media-records.js";

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

export interface MediaMotionCreateData {
  id: string;
  mediaId: string;
  storageKey: string;
  thumbKey: string | null;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
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
      include: { motion: true },
    })) as MediaRecord | null;
  }

  /**
   * `tx` is optional so the single-file presign keeps its historical call shape;
   * `presignBatch` passes the shared transaction so all N rows commit together.
   */
  async createMedia(data: MediaCreateData, tx?: ContentTransaction): Promise<MediaRecord> {
    const client = tx ?? this.prisma.client;
    return (await client.media.create({ data: data as never })) as MediaRecord;
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
      include: { motion: true },
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
      include: { motion: true },
    })) as MediaRecord;
  }

  /** Live (non-deleted) motion row of one still, if any. */
  async findMotion(mediaId: string): Promise<MediaMotionRecord | null> {
    return (await this.prisma.client.mediaMotion.findFirst({
      where: { mediaId, deletedAt: null },
    })) as MediaMotionRecord | null;
  }

  /**
   * Creates or revives the 1:1 motion row.
   *
   * The completion callback is idempotent: a retried upload of the same media
   * keeps one row and refreshes its coordinates instead of failing on the
   * `mediaId` unique constraint.
   */
  async upsertMotion(data: MediaMotionCreateData): Promise<MediaMotionRecord> {
    const existing = await this.prisma.client.mediaMotion.findUnique({
      where: { mediaId: data.mediaId },
    });
    if (!existing) {
      return (await this.prisma.client.mediaMotion.create({
        data: { ...data, deletedAt: null } as never,
      })) as MediaMotionRecord;
    }
    return (await this.prisma.client.mediaMotion.update({
      where: { mediaId: data.mediaId },
      data: {
        storageKey: data.storageKey,
        thumbKey: data.thumbKey,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        durationMs: data.durationMs,
        width: data.width,
        height: data.height,
        deletedAt: null,
      },
    })) as MediaMotionRecord;
  }

  async softDelete(
    tx: ContentTransaction,
    workspaceId: string,
    mediaId: string,
  ): Promise<number> {
    const deletedAt = new Date();
    // The paired motion follows the still in the same transaction: leaving it
    // live would keep signing a playable URL for an invisible photo.
    await tx.mediaMotion.updateMany({
      where: { mediaId, deletedAt: null },
      data: { deletedAt },
    });
    const result = await tx.media.updateMany({
      where: { id: mediaId, workspaceId, deletedAt: null },
      data: { deletedAt, status: "failed", error: "Media deleted." },
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