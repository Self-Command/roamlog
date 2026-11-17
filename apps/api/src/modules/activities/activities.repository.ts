import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ActivityRecord } from "../trips/content-records.js";
import type { ContentTransaction } from "../trips/content-transaction.js";

export interface ActivityRecordInput {
  workspaceId: string;
  tripId: string | null;
  actorId: string;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}

@Injectable()
export class ActivitiesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(
    tx: ContentTransaction,
    input: ActivityRecordInput,
  ): Promise<{ id: string }> {
    return tx.activity.create({
      data: {
        ...input,
        metadata: input.metadata as never,
      },
    });
  }

  async findWorkspaceActivities(args: {
    workspaceId: string;
    actorId?: string;
    entityType?: string;
    from?: Date;
    to?: Date;
    cursor?: string;
    take: number;
    direction: "asc" | "desc";
  }): Promise<ActivityRecord[]> {
    return (await this.prisma.client.activity.findMany({
      where: {
        workspaceId: args.workspaceId,
        ...(args.actorId ? { actorId: args.actorId } : {}),
        ...(args.entityType ? { entityType: args.entityType } : {}),
        ...(args.from || args.to
          ? {
              createdAt: {
                ...(args.from ? { gte: args.from } : {}),
                ...(args.to ? { lte: args.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: args.direction }, { id: "asc" }],
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as ActivityRecord[];
  }

  async findTripActivities(args: {
    workspaceId: string;
    tripId: string;
    actorId?: string;
    cursor?: string;
    take: number;
    direction: "asc" | "desc";
  }): Promise<ActivityRecord[]> {
    return (await this.prisma.client.activity.findMany({
      where: {
        workspaceId: args.workspaceId,
        tripId: args.tripId,
        ...(args.actorId ? { actorId: args.actorId } : {}),
      },
      orderBy: [{ createdAt: args.direction }, { id: "asc" }],
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as ActivityRecord[];
  }
}
