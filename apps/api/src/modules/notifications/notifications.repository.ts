import { Inject, Injectable } from "@nestjs/common";
import {
  NotificationSchema,
  type Notification,
  type NotificationPreference,
} from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ContentTransaction } from "../trips/content-transaction.js";

export interface NotificationRecord {
  id: string;
  userId: string;
  workspaceId: string | null;
  tripId: string | null;
  actorId: string | null;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  emailedAt: Date | null;
  createdAt: Date;
}

export interface NotificationUserRecord {
  id: string;
  email: string;
}

export interface PreferenceRecord {
  userId: string;
  type: string;
  inApp: boolean;
  email: boolean;
}

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: ContentTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(callback);
  }

  async findNotificationUsers(userIds: string[]): Promise<NotificationUserRecord[]> {
    return this.prisma.client.user.findMany({
      where: { id: { in: userIds }, deletedAt: null, status: "active" },
      select: { id: true, email: true },
    });
  }

  async findPreferenceRecords(userIds: string[]): Promise<PreferenceRecord[]> {
    return this.prisma.client.notificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, type: true, inApp: true, email: true },
    });
  }

  async createNotification(
    tx: ContentTransaction,
    data: {
      userId: string;
      workspaceId: string;
      tripId: string | null;
      actorId: string | null;
      type: string;
      title: string;
      body: string;
      entityType: string | null;
      entityId: string | null;
    },
  ): Promise<NotificationRecord> {
    return (await tx.notification.create({ data })) as NotificationRecord;
  }

  async createEmailIntent(
    tx: ContentTransaction,
    data: {
      userId: string;
      to: string;
      template: string;
      subject: string;
      status: "queued";
    },
  ): Promise<{ id: string }> {
    return tx.emailLog.create({
      data: {
        userId: data.userId,
        to: data.to,
        template: data.template,
        subject: data.subject,
        status: data.status,
      },
      select: { id: true },
    });
  }

  async listNotifications(args: {
    userId: string;
    unreadOnly: boolean;
    cursor?: string;
    take: number;
    direction: "asc" | "desc";
  }): Promise<NotificationRecord[]> {
    return (await this.prisma.client.notification.findMany({
      where: {
        userId: args.userId,
        ...(args.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ createdAt: args.direction }, { id: "asc" }],
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as NotificationRecord[];
  }

  async markNotificationRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationRecord | null> {
    const notification = await this.prisma.client.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      return null;
    }
    return (await this.prisma.client.notification.update({
      where: { id: notificationId },
      data: { readAt: notification.readAt ?? new Date() },
    })) as NotificationRecord;
  }

  async markAllNotificationsRead(userId: string): Promise<number> {
    const result = await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async listPreferences(userId: string): Promise<PreferenceRecord[]> {
    return this.prisma.client.notificationPreference.findMany({
      where: { userId },
      orderBy: { type: "asc" },
      select: { userId: true, type: true, inApp: true, email: true },
    });
  }

  async upsertPreferences(
    tx: ContentTransaction,
    userId: string,
    preferences: Array<{ type: string; inApp: boolean; email: boolean }>,
  ): Promise<NotificationPreference[]> {
    const rows = await Promise.all(
      preferences.map((preference) =>
        tx.notificationPreference.upsert({
          where: { userId_type: { userId, type: preference.type } },
          create: { userId, ...preference },
          update: preference,
          select: { userId: true, type: true, inApp: true, email: true },
        }),
      ),
    );
    return rows as NotificationPreference[];
  }

  present(record: NotificationRecord): Notification {
    return NotificationSchema.parse({
      id: record.id,
      userId: record.userId,
      workspaceId: record.workspaceId,
      tripId: record.tripId,
      actorId: record.actorId,
      type: record.type.slice(0, 64),
      title: record.title.slice(0, 180),
      body: record.body.slice(0, 2_000),
      entityType: record.entityType?.slice(0, 60) ?? null,
      entityId: record.entityId,
      readAt: record.readAt?.toISOString() ?? null,
      emailedAt: record.emailedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    });
  }
}
