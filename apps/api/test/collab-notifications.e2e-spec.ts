import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import {
  USER_EDITOR_ID,
  USER_OWNER_ID,
  NOW,
  WORKSPACE_A_ID,
  makeActor,
} from "./identity-fixtures.js";
import { TRIP_A_ID, fakeTransaction } from "./content-fixtures.js";

const NOTIFICATION_ID = "01942f30-1200-7000-8000-000000000901";

function notificationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    userId: USER_OWNER_ID,
    workspaceId: WORKSPACE_A_ID,
    tripId: TRIP_A_ID,
    actorId: USER_EDITOR_ID,
    type: "mention",
    title: "You were mentioned",
    body: "A comment mentions you.",
    entityType: "comment",
    entityId: "01942f30-1200-7000-8000-000000000801",
    readAt: null,
    emailedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  const repository = {
    transaction: vi.fn(),
    findNotificationUsers: vi.fn(),
    findPreferenceRecords: vi.fn(),
    createNotification: vi.fn(),
    createEmailIntent: vi.fn(),
    listNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    listPreferences: vi.fn(),
    upsertPreferences: vi.fn(),
  };
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(),
  };
  const service = new NotificationsService(repository as never, publisher as never);
  return { repository, publisher, service };
}

describe("NotificationsService", () => {
  it("scopes notification reads and updates to the authenticated recipient", async () => {
    const { repository, service } = setup();
    repository.listNotifications.mockResolvedValue([]);
    repository.markNotificationRead.mockResolvedValue(null);

    await service.list(makeActor(USER_EDITOR_ID), { limit: 20 });
    expect(repository.listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_EDITOR_ID }),
    );

    await expect(
      service.markRead(makeActor(USER_EDITOR_ID), NOTIFICATION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.markNotificationRead).toHaveBeenCalledWith(
      USER_EDITOR_ID,
      NOTIFICATION_ID,
    );
  });

  it("deduplicates recipients and respects per-type in-app/email preferences", async () => {
    const { repository, publisher, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findNotificationUsers.mockResolvedValue([
      { id: USER_OWNER_ID, email: "owner@roamlog.test" },
      { id: USER_EDITOR_ID, email: "editor@roamlog.test" },
    ]);
    repository.findPreferenceRecords.mockResolvedValue([
      { userId: USER_EDITOR_ID, type: "mention", inApp: false, email: true },
    ]);
    repository.createNotification.mockResolvedValue(notificationRecord());
    repository.createEmailIntent.mockResolvedValue({ id: "email-log" });

    const result = await service.createAndPublish([
      {
        userId: USER_OWNER_ID,
        workspaceId: WORKSPACE_A_ID,
        tripId: TRIP_A_ID,
        actorId: USER_EDITOR_ID,
        type: "mention",
        title: "You were mentioned",
        body: "A comment mentions you.",
        entityType: "comment",
        entityId: "01942f30-1200-7000-8000-000000000801",
      },
      {
        userId: USER_OWNER_ID,
        workspaceId: WORKSPACE_A_ID,
        tripId: TRIP_A_ID,
        actorId: USER_EDITOR_ID,
        type: "mention",
        title: "Duplicate delivery",
        body: "Duplicate delivery.",
      },
      {
        userId: USER_EDITOR_ID,
        workspaceId: WORKSPACE_A_ID,
        tripId: TRIP_A_ID,
        actorId: USER_OWNER_ID,
        type: "mention",
        title: "Email only",
        body: "Email only.",
      },
    ]);

    expect(repository.createNotification).toHaveBeenCalledTimes(1);
    expect(repository.createNotification).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: USER_OWNER_ID, type: "mention" }),
    );
    expect(repository.createEmailIntent).toHaveBeenCalledTimes(2);
    expect(repository.createEmailIntent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: USER_OWNER_ID, status: "queued" }),
    );
    expect(repository.createEmailIntent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: USER_EDITOR_ID, status: "queued" }),
    );
    expect(result.notifications).toHaveLength(1);
    expect(publisher.publishMany).toHaveBeenCalledOnce();
  });

  it("updates only the authenticated user's preferences", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.upsertPreferences.mockResolvedValue([
      { userId: USER_EDITOR_ID, type: "mention", inApp: true, email: false },
    ]);

    const result = await service.updatePreferences(makeActor(USER_EDITOR_ID), {
      preferences: [
        { type: "mention", inApp: false, email: true },
        { type: "mention", inApp: true, email: false },
      ],
    });

    expect(repository.upsertPreferences).toHaveBeenCalledWith(tx, USER_EDITOR_ID, [
      { type: "mention", inApp: true, email: false },
    ]);
    expect(result).toEqual([
      { userId: USER_EDITOR_ID, type: "mention", inApp: true, email: false },
    ]);
  });
});
