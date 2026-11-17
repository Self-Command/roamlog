import type { SeedDataset } from "./types.js";
import {
  dateTime,
  json,
  nullableDateTime,
  type SeedTransaction,
} from "./apply-utils.js";

export async function applyOperations(
  tx: SeedTransaction,
  data: SeedDataset,
): Promise<void> {
  for (const activity of data.activities) {
    const fields = {
      workspaceId: activity.workspaceId,
      tripId: activity.tripId,
      actorId: activity.actorId,
      verb: activity.verb,
      entityType: activity.entityType,
      entityId: activity.entityId,
      metadata: json(activity.metadata),
      createdAt: dateTime(activity.createdAt),
    };
    await tx.activity.upsert({
      where: { id: activity.id },
      update: fields,
      create: { id: activity.id, ...fields },
    });
  }

  for (const link of data.shareLinks) {
    const fields = {
      workspaceId: link.workspaceId,
      tripId: link.tripId,
      tokenHash: link.tokenHash,
      createdById: link.createdById,
      expiresAt: nullableDateTime(link.expiresAt),
      revokedAt: nullableDateTime(link.revokedAt),
      passwordHash: link.passwordHash,
      allowIndex: link.allowIndex,
      showBudget: link.showBudget,
      lastAccessedAt: nullableDateTime(link.lastAccessedAt),
      accessCount: link.accessCount,
      createdAt: dateTime(link.createdAt),
    };
    await tx.shareLink.upsert({
      where: { id: link.id },
      update: fields,
      create: { id: link.id, ...fields },
    });
  }

  for (const notification of data.notifications) {
    const fields = {
      userId: notification.userId,
      workspaceId: notification.workspaceId,
      tripId: notification.tripId,
      actorId: notification.actorId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: notification.entityType,
      entityId: notification.entityId,
      readAt: nullableDateTime(notification.readAt),
      emailedAt: nullableDateTime(notification.emailedAt),
      createdAt: dateTime(notification.createdAt),
    };
    await tx.notification.upsert({
      where: { id: notification.id },
      update: fields,
      create: { id: notification.id, ...fields },
    });
  }

  for (const preference of data.notificationPreferences) {
    const fields = {
      userId: preference.userId,
      type: preference.type,
      inApp: preference.inApp,
      email: preference.email,
    };
    await tx.notificationPreference.upsert({
      where: {
        userId_type: {
          userId: preference.userId,
          type: preference.type,
        },
      },
      update: fields,
      create: fields,
    });
  }

  for (const audit of data.auditLogs) {
    const fields = {
      actorId: audit.actorId,
      actorType: audit.actorType,
      action: audit.action,
      targetType: audit.targetType,
      targetId: audit.targetId,
      workspaceId: audit.workspaceId,
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: json(audit.metadata),
      createdAt: dateTime(audit.createdAt),
    };
    await tx.auditLog.upsert({
      where: { id: audit.id },
      update: fields,
      create: { id: audit.id, ...fields },
    });
  }

  for (const flag of data.featureFlags) {
    const fields = {
      key: flag.key,
      description: flag.description,
      enabled: flag.enabled,
      rolloutPercentage: flag.rolloutPercentage,
      rules: json(flag.rules),
      updatedById: flag.updatedById,
      createdAt: dateTime(flag.createdAt),
      updatedAt: dateTime(flag.updatedAt),
    };
    await tx.featureFlag.upsert({
      where: { key: flag.key },
      update: fields,
      create: fields,
    });
  }

  for (const email of data.emailLogs) {
    const fields = {
      userId: email.userId,
      to: email.to,
      template: email.template,
      subject: email.subject,
      providerId: email.providerId,
      status: email.status,
      error: email.error,
      createdAt: dateTime(email.createdAt),
      updatedAt: dateTime(email.updatedAt),
    };
    await tx.emailLog.upsert({
      where: { id: email.id },
      update: fields,
      create: { id: email.id, ...fields },
    });
  }

  for (const record of data.exports) {
    const fields = {
      workspaceId: record.workspaceId,
      tripId: record.tripId,
      requestedById: record.requestedById,
      scope: record.scope,
      format: record.format,
      includeComments: record.includeComments,
      includeExpenses: record.includeExpenses,
      includeMedia: record.includeMedia,
      status: record.status,
      storageKey: record.storageKey,
      error: record.error,
      expiresAt: nullableDateTime(record.expiresAt),
      createdAt: dateTime(record.createdAt),
      completedAt: nullableDateTime(record.completedAt),
    };
    await tx.export.upsert({
      where: { id: record.id },
      update: fields,
      create: { id: record.id, ...fields },
    });
  }
}
