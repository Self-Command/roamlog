import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  MyNotificationsQuerySchema,
  UpdateNotificationPreferencesRequestSchema,
  type MarkNotificationReadResponse,
  type NotificationPage,
  type NotificationPreferencesResponse,
  type ReadAllNotificationsResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { sortParts } from "../trips/content-values.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import { RealtimePublisher, type RealtimeEventDraft } from "../realtime/realtime.publisher.js";
import {
  NotificationsRepository,
  type NotificationRecord,
} from "./notifications.repository.js";

export interface NotificationCreateInput {
  userId: string;
  workspaceId: string;
  tripId?: string | null;
  actorId?: string | null;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
}

export interface NotificationMutationResult {
  notifications: NotificationRecord[];
  emailIntents: number;
  events: RealtimeEventDraft[];
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NotificationsRepository) private readonly repository: NotificationsRepository,
    @Inject(RealtimePublisher) private readonly publisher: RealtimePublisher,
  ) {}

  async list(_actor: AuthenticatedActor, rawQuery: unknown): Promise<NotificationPage> {
    const query = parseRequest(MyNotificationsQuerySchema, rawQuery);
    const { direction } = sortParts(query.sort, ["createdAt"], "createdAt");
    const records = await this.repository.listNotifications({
      userId: _actor.user.id,
      unreadOnly: query.unreadOnly ?? false,
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
      direction,
    });
    return toCursorPage(records, query.limit, (record) =>
      this.repository.present(record),
    ) as NotificationPage;
  }

  async markRead(
    actor: AuthenticatedActor,
    notificationId: string,
  ): Promise<MarkNotificationReadResponse> {
    const record = await this.repository.markNotificationRead(
      actor.user.id,
      notificationId,
    );
    if (!record) {
      throw new NotFoundException({
        code: "NOTIFICATION_NOT_FOUND",
        message: "The requested notification was not found.",
      });
    }
    return this.repository.present(record);
  }

  async readAll(actor: AuthenticatedActor): Promise<ReadAllNotificationsResponse> {
    return {
      updatedCount: await this.repository.markAllNotificationsRead(actor.user.id),
    };
  }

  async listPreferences(
    actor: AuthenticatedActor,
  ): Promise<NotificationPreferencesResponse> {
    return this.repository.listPreferences(actor.user.id);
  }

  async updatePreferences(
    actor: AuthenticatedActor,
    rawInput: unknown,
  ): Promise<NotificationPreferencesResponse> {
    const input = parseRequest(UpdateNotificationPreferencesRequestSchema, rawInput);
    return this.repository.transaction(async (tx) => {
      const unique = new Map(input.preferences.map((preference) => [preference.type, preference]));
      const rows = await this.repository.upsertPreferences(
        tx,
        actor.user.id,
        [...unique.values()],
      );
      return rows.map((preference) => ({
        userId: preference.userId,
        type: preference.type,
        inApp: preference.inApp,
        email: preference.email,
      }));
    });
  }

  async createInTransaction(
    tx: ContentTransaction,
    inputs: readonly NotificationCreateInput[],
  ): Promise<NotificationMutationResult> {
    const unique = dedupeInputs(inputs);
    const userIds = [...new Set(unique.map((input) => input.userId))];
    if (userIds.length === 0) {
      return { notifications: [], emailIntents: 0, events: [] };
    }

    const [users, preferenceRows] = await Promise.all([
      this.repository.findNotificationUsers(userIds),
      this.repository.findPreferenceRecords(userIds),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const preferences = new Map(
      preferenceRows.map((preference) => [
        `${preference.userId}:${preference.type}`,
        preference,
      ]),
    );

    const notifications: NotificationRecord[] = [];
    const events: RealtimeEventDraft[] = [];
    let emailIntents = 0;

    for (const input of unique) {
      const user = userById.get(input.userId);
      if (!user) {
        continue;
      }
      const preference = preferences.get(`${input.userId}:${input.type}`);
      const inApp = preference?.inApp ?? true;
      const email = preference?.email ?? true;
      if (!inApp && !email) {
        continue;
      }

      let notificationId = input.entityId ?? input.type;
      if (inApp) {
        const record = await this.repository.createNotification(tx, {
          userId: input.userId,
          workspaceId: input.workspaceId,
          tripId: input.tripId ?? null,
          actorId: input.actorId ?? null,
          type: input.type,
          title: input.title.slice(0, 180) || input.type.slice(0, 180),
          body: input.body.slice(0, 2_000),
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        });
        notifications.push(record);
        notificationId = record.id;
        events.push({
          type: "notification.created",
          workspaceId: input.workspaceId,
          ...(input.tripId ? { tripId: input.tripId } : {}),
          payload: { userId: input.userId, notificationId: record.id },
        } as RealtimeEventDraft);
      }

      if (email) {
        await this.repository.createEmailIntent(tx, {
          userId: user.id,
          to: user.email,
          template: input.type,
          subject: input.title,
          status: "queued",
        });
        emailIntents += 1;
      } else {
        void notificationId;
      }
    }

    return { notifications, emailIntents, events };
  }

  async createAndPublish(
    inputs: readonly NotificationCreateInput[],
  ): Promise<NotificationMutationResult> {
    const result = await this.repository.transaction((tx) =>
      this.createInTransaction(tx, inputs),
    );
    this.publisher.publishMany(result.events);
    return result;
  }

  publishCreated(result: NotificationMutationResult): void {
    this.publisher.publishMany(result.events);
  }

  async notifyAssignment(
    tx: ContentTransaction,
    input: NotificationCreateInput & {
      assignedById: string;
      assignedByName: string;
    },
  ): Promise<NotificationMutationResult> {
    return this.createInTransaction(tx, [
      {
        userId: input.userId,
        workspaceId: input.workspaceId,
        tripId: input.tripId ?? null,
        actorId: input.assignedById,
        type: input.type,
        title: input.title,
        body: `${input.assignedByName} assigned you to ${input.body}`.slice(0, 2_000),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    ]);
  }
}

function dedupeInputs(
  inputs: readonly NotificationCreateInput[],
): NotificationCreateInput[] {
  const unique = new Map<string, NotificationCreateInput>();
  for (const input of inputs) {
    const key = [input.userId, input.type].join(":");
    if (!unique.has(key)) {
      unique.set(key, input);
    }
  }
  return [...unique.values()];
}
