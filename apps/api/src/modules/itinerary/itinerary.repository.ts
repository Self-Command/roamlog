import { Inject, Injectable } from "@nestjs/common";
import type { ItineraryItemType } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ItineraryRecord, MaxOrderResult } from "../trips/content-records.js";
import type { ContentTransaction } from "../trips/content-transaction.js";

export interface ItineraryCreateData {
  workspaceId: string;
  tripId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  title: string;
  type: ItineraryItemType;
  location: string;
  notes: string;
  done: boolean;
  order: number;
  assigneeId: string | null;
  createdById: string;
  updatedById: string;
}

export interface ItineraryUpdateData {
  date?: Date;
  startTime?: string | null;
  endTime?: string | null;
  title?: string;
  type?: ItineraryItemType;
  location?: string;
  notes?: string;
  done?: boolean;
  order?: number;
  assigneeId?: string | null;
  updatedById: string;
}

@Injectable()
export class ItineraryRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async listItems(workspaceId: string, tripId: string): Promise<ItineraryRecord[]> {
    return (await this.prisma.client.itineraryItem.findMany({
      where: { workspaceId, tripId, deletedAt: null },
      orderBy: [{ date: "asc" }, { order: "asc" }, { id: "asc" }],
    })) as ItineraryRecord[];
  }

  async findItem(
    workspaceId: string,
    itemId: string,
    tx?: ContentTransaction,
  ): Promise<ItineraryRecord | null> {
    return (await (tx ?? this.prisma.client).itineraryItem.findFirst({
      where: {
        id: itemId,
        workspaceId,
        deletedAt: null,
        trip: { deletedAt: null },
      },
    })) as ItineraryRecord | null;
  }

  async maxOrder(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    date: Date,
  ): Promise<MaxOrderResult> {
    return tx.itineraryItem.aggregate({
      where: { workspaceId, tripId, date, deletedAt: null },
      _max: { order: true },
    });
  }

  async createItem(
    tx: ContentTransaction,
    data: ItineraryCreateData,
  ): Promise<ItineraryRecord> {
    return (await tx.itineraryItem.create({ data })) as ItineraryRecord;
  }

  async updateItem(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      itemId: string;
      version: number;
      data: ItineraryUpdateData;
    },
  ) {
    const result = await tx.itineraryItem.updateMany({
      where: {
        id: args.itemId,
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

  async softDeleteItem(
    tx: ContentTransaction,
    args: { workspaceId: string; itemId: string; actorId: string },
  ) {
    const result = await tx.itineraryItem.updateMany({
      where: {
        id: args.itemId,
        workspaceId: args.workspaceId,
        deletedAt: null,
      },
      data: { deletedAt: new Date(), updatedById: args.actorId },
    });
    return result.count;
  }

  async findItemsByIds(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    ids: string[],
  ): Promise<ItineraryRecord[]> {
    return (await tx.itineraryItem.findMany({
      where: {
        id: { in: ids },
        workspaceId,
        tripId,
        deletedAt: null,
      },
    })) as ItineraryRecord[];
  }

  async setOrders(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    items: Array<{ id: string; order: number }>,
  ): Promise<ItineraryRecord[]> {
    for (const item of items) {
      await tx.itineraryItem.updateMany({
        where: { id: item.id, workspaceId, tripId, deletedAt: null },
        data: { order: item.order },
      });
    }
    return (await tx.itineraryItem.findMany({
      where: { workspaceId, tripId, deletedAt: null },
      orderBy: [{ date: "asc" }, { order: "asc" }, { id: "asc" }],
    })) as ItineraryRecord[];
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
}
