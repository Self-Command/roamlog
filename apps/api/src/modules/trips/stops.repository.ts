import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { MaxOrderResult, StopRecord, TripRecord } from "./content-records.js";
import type { ContentTransaction } from "./content-transaction.js";

export interface StopCreateData {
  workspaceId: string;
  tripId: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  startDate: Date;
  endDate: Date;
  notes: string;
  order: number;
  provider: string | null;
  providerPlaceId: string | null;
  timeZone: string | null;
  createdById: string;
  updatedById: string;
}

export interface StopUpdateData {
  city?: string;
  country?: string;
  countryCode?: string;
  lat?: number | null;
  lng?: number | null;
  startDate?: Date;
  endDate?: Date;
  notes?: string;
  order?: number;
  provider?: string | null;
  providerPlaceId?: string | null;
  timeZone?: string | null;
  updatedById: string;
}

@Injectable()
export class StopsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findTrip(
    workspaceId: string,
    tripId: string,
    tx?: ContentTransaction,
  ): Promise<TripRecord | null> {
    return (await (tx ?? this.prisma.client).trip.findFirst({
      where: { id: tripId, workspaceId, deletedAt: null },
    })) as TripRecord | null;
  }

  async listStops(workspaceId: string, tripId: string): Promise<StopRecord[]> {
    return (await this.prisma.client.stop.findMany({
      where: { workspaceId, tripId, deletedAt: null },
      orderBy: [{ order: "asc" }, { startDate: "asc" }, { id: "asc" }],
    })) as StopRecord[];
  }

  async findStop(
    workspaceId: string,
    stopId: string,
    tx?: ContentTransaction,
  ): Promise<StopRecord | null> {
    return (await (tx ?? this.prisma.client).stop.findFirst({
      where: {
        id: stopId,
        workspaceId,
        deletedAt: null,
        trip: { deletedAt: null },
      },
    })) as StopRecord | null;
  }

  async maxOrder(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
  ): Promise<MaxOrderResult> {
    return tx.stop.aggregate({
      where: { workspaceId, tripId, deletedAt: null },
      _max: { order: true },
    });
  }

  async createStop(tx: ContentTransaction, data: StopCreateData): Promise<StopRecord> {
    return (await tx.stop.create({ data })) as StopRecord;
  }

  async updateStop(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      stopId: string;
      version: number;
      data: StopUpdateData;
    },
  ) {
    const result = await tx.stop.updateMany({
      where: {
        id: args.stopId,
        workspaceId: args.workspaceId,
        version: args.version,
        deletedAt: null,
      },
      data: {
        ...args.data,
        version: { increment: 1 },
      },
    });
    return result.count;
  }

  async softDeleteStop(
    tx: ContentTransaction,
    args: { workspaceId: string; stopId: string; actorId: string },
  ) {
    const result = await tx.stop.updateMany({
      where: { id: args.stopId, workspaceId: args.workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: args.actorId },
    });
    return result.count;
  }

  async findStopsByIds(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    ids: string[],
  ): Promise<StopRecord[]> {
    return (await tx.stop.findMany({
      where: {
        id: { in: ids },
        workspaceId,
        tripId,
        deletedAt: null,
      },
    })) as StopRecord[];
  }

  async setOrders(
    tx: ContentTransaction,
    workspaceId: string,
    tripId: string,
    actorId: string,
    items: Array<{ id: string; order: number }>,
  ): Promise<StopRecord[]> {
    for (const item of items) {
      await tx.stop.updateMany({
        where: { id: item.id, workspaceId, tripId, deletedAt: null },
        data: { order: item.order, updatedById: actorId },
      });
    }
    return (await tx.stop.findMany({
      where: { workspaceId, tripId, deletedAt: null },
      orderBy: [{ order: "asc" }, { startDate: "asc" }, { id: "asc" }],
    })) as StopRecord[];
  }
}
