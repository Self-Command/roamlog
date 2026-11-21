import { Inject, Injectable } from "@nestjs/common";
import type { CommentTargetType } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ContentTransaction } from "../trips/content-transaction.js";

export interface CommentRecord {
  id: string;
  workspaceId: string;
  tripId: string;
  targetType: CommentTargetType;
  targetId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  resolvedAt: Date | null;
  resolvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CommentTargetRecord {
  id: string;
  tripId: string;
  workspaceId: string;
  createdById: string;
  targetType: CommentTargetType;
}

export interface CommentTripRecord {
  id: string;
  workspaceId: string;
  visibility: string;
  createdById: string;
  participants?: Array<{ userId: string; status: string }>;
  accessGrants?: Array<{ workspaceId: string | null; userId: string | null }>;
}

@Injectable()
export class CommentsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findTarget(
    targetType: CommentTargetType,
    targetId: string,
  ): Promise<CommentTargetRecord | null> {
    if (targetType === "journal_entry") {
      const entry = await this.prisma.client.journalEntry.findFirst({
        where: {
          id: targetId,
          deletedAt: null,
          trip: { deletedAt: null },
        },
        select: {
          id: true,
          tripId: true,
          workspaceId: true,
          createdById: true,
        },
      });
      return entry ? { ...entry, targetType } : null;
    }

    const item = await this.prisma.client.itineraryItem.findFirst({
      where: {
        id: targetId,
        deletedAt: null,
        trip: { deletedAt: null },
      },
      select: {
        id: true,
        tripId: true,
        workspaceId: true,
        createdById: true,
      },
    });
    return item ? { ...item, targetType } : null;
  }

  async findTrip(
    workspaceId: string,
    tripId: string,
  ): Promise<CommentTripRecord | null> {
    return this.prisma.client.trip.findFirst({
      where: { id: tripId, workspaceId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        visibility: true,
        createdById: true,
        participants: { select: { userId: true, status: true } },
        accessGrants: { select: { workspaceId: true, userId: true } },
      },
    });
  }

  async listComments(args: {
    workspaceId: string;
    targetType: CommentTargetType;
    targetId: string;
    cursor?: string;
    take: number;
    direction: "asc" | "desc";
  }): Promise<CommentRecord[]> {
    return (await this.prisma.client.comment.findMany({
      where: {
        workspaceId: args.workspaceId,
        targetType: args.targetType,
        targetId: args.targetId,
        deletedAt: null,
      },
      orderBy: [{ createdAt: args.direction }, { id: "asc" }],
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as CommentRecord[];
  }

  async findComment(
    workspaceId: string,
    commentId: string,
    tx?: ContentTransaction,
  ): Promise<CommentRecord | null> {
    return (await (tx ?? this.prisma.client).comment.findFirst({
      where: { id: commentId, workspaceId, deletedAt: null },
    })) as CommentRecord | null;
  }

  async findCommentById(commentId: string): Promise<CommentRecord | null> {
    return (await this.prisma.client.comment.findFirst({
      where: { id: commentId, deletedAt: null },
    })) as CommentRecord | null;
  }

  async findParent(
    workspaceId: string,
    parentId: string,
    tx?: ContentTransaction,
  ): Promise<CommentRecord | null> {
    return (await (tx ?? this.prisma.client).comment.findFirst({
      where: { id: parentId, workspaceId, deletedAt: null },
    })) as CommentRecord | null;
  }

  async findActiveMemberIds(
    workspaceId: string,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }
    const members = await this.prisma.client.workspaceMember.findMany({
      where: {
        workspaceId,
        userId: { in: userIds },
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  async createComment(
    tx: ContentTransaction,
    data: {
      workspaceId: string;
      tripId: string;
      targetType: CommentTargetType;
      targetId: string;
      parentId: string | null;
      authorId: string;
      body: string;
    },
  ): Promise<CommentRecord> {
    return (await tx.comment.create({ data })) as CommentRecord;
  }

  async createMentions(
    tx: ContentTransaction,
    data: Array<{ workspaceId: string; commentId: string; userId: string }>,
  ): Promise<void> {
    if (data.length === 0) {
      return;
    }
    await tx.commentMention.createMany({ data, skipDuplicates: true });
  }

  async updateComment(
    tx: ContentTransaction,
    args: { workspaceId: string; commentId: string; body: string },
  ): Promise<CommentRecord> {
    return (await tx.comment.update({
      where: { id: args.commentId },
      data: { body: args.body },
    })) as CommentRecord;
  }

  async setResolved(
    tx: ContentTransaction,
    args: {
      workspaceId: string;
      commentId: string;
      resolvedById: string | null;
      resolvedAt: Date | null;
    },
  ): Promise<CommentRecord> {
    return (await tx.comment.update({
      where: { id: args.commentId },
      data: {
        resolvedAt: args.resolvedAt,
        resolvedById: args.resolvedById,
      },
    })) as CommentRecord;
  }

  async softDeleteComment(
    tx: ContentTransaction,
    args: { workspaceId: string; commentId: string },
  ): Promise<number> {
    const result = await tx.comment.updateMany({
      where: {
        workspaceId: args.workspaceId,
        deletedAt: null,
        OR: [{ id: args.commentId }, { parentId: args.commentId }],
      },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }
}
