import { Inject, Injectable } from "@nestjs/common";
import type { PackingCategory } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import type { PackingItemRecord } from "./packing-records.js";

export interface PackingCreateData {
  workspaceId: string;
  tripId: string;
  category: PackingCategory;
  name: string;
  quantity: number;
  assigneeId: string | null;
  order: number;
  createdById: string;
  updatedById: string;
}

@Injectable()
export class PackingRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findItem(
    workspaceId: string,
    itemId: string,
    tx?: ContentTransaction,
  ): Promise<PackingItemRecord | null> {
    const client = tx ?? this.prisma.client;
    return (await client.packingItem.findFirst({
      where: {
        id: itemId,
        workspaceId,
        deletedAt: null,
        trip: { deletedAt: null },
      },
    })) as PackingItemRecord | null;
  }

  async listItems(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    cursor?: string;
    take: number;
  }): Promise<PackingItemRecord[]> {
    return (await this.prisma.client.packingItem.findMany({
      where: args.where as never,
      orderBy: args.orderBy as never,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as PackingItemRecord[];
  }

  async listAll(
    workspaceId: string,
    tripId: string,
    tx?: ContentTransaction,
  ): Promise<PackingItemRecord[]> {
    const client = tx ?? this.prisma.client;
    return (await client.packingItem.findMany({
      where: { workspaceId, tripId, deletedAt: null },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    })) as PackingItemRecord[];
  }

  async maxOrder(workspaceId: string, tripId: string): Promise<number | null> {
    const result = await this.prisma.client.packingItem.aggregate({
      where: { workspaceId, tripId, deletedAt: null },
      _max: { order: true },
    });
    return result._max.order;
  }

  async createItem(
    tx: ContentTransaction,
    data: PackingCreateData,
  ): Promise<PackingItemRecord> {
    return (await tx.packingItem.create({ data })) as PackingItemRecord;
  }

  async updateItem(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      itemId: string;
      version: number;
      data: Record<string, unknown>;
    },
  ): Promise<number> {
    const result = await tx.packingItem.updateMany({
      where: {
        id: args.itemId,
        workspaceId: args.workspaceId,
        version: args.version,
        deletedAt: null,
      },
      data: { ...(args.data as Record<string, unknown>), version: { increment: 1 }, updatedAt: new Date() } as never,
    });
    return result.count;
  }

  async softDeleteItem(
    tx: ContentTransaction,
    workspaceId: string,
    itemId: string,
    actorId: string,
  ): Promise<number> {
    const result = await tx.packingItem.updateMany({
      where: { id: itemId, workspaceId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        updatedAt: new Date(),
        updatedById: actorId,
      },
    });
    return result.count;
  }

  async setOrder(
    tx: ContentTransaction,
    workspaceId: string,
    itemId: string,
    order: number,
  ): Promise<void> {
    await tx.packingItem.updateMany({
      where: { id: itemId, workspaceId, deletedAt: null },
      data: { order, updatedAt: new Date(), version: { increment: 1 } },
    });
  }

  async activeMemberIds(workspaceId: string, userIds: readonly string[]): Promise<Set<string>> {
    const members = await this.prisma.client.workspaceMember.findMany({
      where: {
        workspaceId,
        userId: { in: [...userIds] },
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { userId: true },
    });
    return new Set(members.map((member) => member.userId));
  }
}
