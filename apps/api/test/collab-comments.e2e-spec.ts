import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import { SanitizeService } from "../src/common/services/sanitize.service.js";
import { CommentsService } from "../src/modules/comments/comments.service.js";
import {
  USER_EDITOR_ID,
  USER_OUTSIDER_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  NOW,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
  makeActor,
} from "./identity-fixtures.js";
import {
  ENTRY_ID,
  ITINERARY_ID,
  TRIP_A_ID,
  fakeTransaction,
  membership,
  tripRecord,
} from "./content-fixtures.js";

const COMMENT_ID = "01942f30-1200-7000-8000-000000000801";
const PARENT_ID = "01942f30-1200-7000-8000-000000000802";

function targetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tripId: TRIP_A_ID,
    workspaceId: WORKSPACE_A_ID,
    createdById: USER_OWNER_ID,
    targetType: "journal_entry",
    ...overrides,
  };
}

function commentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    workspaceId: WORKSPACE_A_ID,
    tripId: TRIP_A_ID,
    targetType: "journal_entry",
    targetId: ENTRY_ID,
    parentId: null,
    authorId: USER_EDITOR_ID,
    body: "The noodles were excellent.",
    resolvedAt: null,
    resolvedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function setup() {
  const repository = {
    transaction: vi.fn(),
    findTarget: vi.fn(),
    findTrip: vi.fn(),
    listComments: vi.fn(),
    findComment: vi.fn(),
    findCommentById: vi.fn(),
    findParent: vi.fn(),
    findActiveMemberIds: vi.fn(),
    createComment: vi.fn(),
    createMentions: vi.fn(),
    updateComment: vi.fn(),
    setResolved: vi.fn(),
    softDeleteComment: vi.fn(),
  };
  const activities = { record: vi.fn().mockResolvedValue({ id: COMMENT_ID }) };
  const notifications = {
    createInTransaction: vi.fn().mockResolvedValue({ notifications: [], emailIntents: 0, events: [] }),
  };
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(),
  };
  const service = new CommentsService(
    repository as never,
    new PermissionService(),
    activities as never,
    notifications as never,
    publisher as never,
    new SanitizeService(),
  );
  return { repository, activities, notifications, publisher, service };
}

describe("CommentsService", () => {
  it("accepts one level of replies and returns the created reply", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTarget.mockResolvedValue(targetRecord());
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.findParent.mockResolvedValue(commentRecord({ id: PARENT_ID, parentId: null }));
    repository.createComment.mockResolvedValue(
      commentRecord({ id: COMMENT_ID, parentId: PARENT_ID, body: "One reply." }),
    );
    repository.createMentions.mockResolvedValue(undefined);

    const reply = await service.create(
      makeActor(USER_VIEWER_ID),
      membership("viewer"),
      {
        tripId: TRIP_A_ID,
        targetType: "journal_entry",
        targetId: ENTRY_ID,
        parentId: PARENT_ID,
        body: "One reply.",
      },
    );

    expect(reply).toMatchObject({ id: COMMENT_ID, parentId: PARENT_ID, body: "One reply." });
    expect(repository.createComment).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ parentId: PARENT_ID }),
    );
  });

  it("allows a Viewer to create a comment and rejects a reply to a reply", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTarget.mockResolvedValue(targetRecord());
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.findParent.mockResolvedValue(
      commentRecord({ id: PARENT_ID, parentId: COMMENT_ID }),
    );

    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership("viewer"), {
        tripId: TRIP_A_ID,
        targetType: "journal_entry",
        targetId: ENTRY_ID,
        parentId: PARENT_ID,
        body: "Nested replies are not supported.",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createComment).not.toHaveBeenCalled();
  });

  it("deduplicates mention ids before persisting and notifying", async () => {
    const { repository, notifications, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTarget.mockResolvedValue(targetRecord());
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.findActiveMemberIds.mockResolvedValue([USER_OWNER_ID, USER_VIEWER_ID]);
    repository.createComment.mockResolvedValue(commentRecord());
    repository.createMentions.mockResolvedValue(undefined);
    repository.findComment.mockResolvedValue(commentRecord());

    await service.create(makeActor(USER_EDITOR_ID), membership("editor"), {
      tripId: TRIP_A_ID,
      targetType: "journal_entry",
      targetId: ENTRY_ID,
      body: "Great recommendation, @owner and @viewer.",
      mentionUserIds: [USER_OWNER_ID, USER_VIEWER_ID, USER_OWNER_ID],
    });

    expect(repository.createMentions).toHaveBeenCalledWith(tx, [
      { workspaceId: WORKSPACE_A_ID, commentId: COMMENT_ID, userId: USER_OWNER_ID },
      { workspaceId: WORKSPACE_A_ID, commentId: COMMENT_ID, userId: USER_VIEWER_ID },
    ]);
    expect(notifications.createInTransaction).toHaveBeenCalledWith(
      tx,
      expect.arrayContaining([
        expect.objectContaining({ userId: USER_OWNER_ID, type: "mention" }),
        expect.objectContaining({ userId: USER_VIEWER_ID, type: "mention" }),
      ]),
    );
    const recipientIds = notifications.createInTransaction.mock.calls[0]?.[1].map(
      (item: { userId: string }) => item.userId,
    );
    expect(recipientIds?.filter((id: string) => id === USER_OWNER_ID)).toHaveLength(1);
  });

  it("returns 404 instead of reading or writing a target in another Workspace", async () => {
    const { repository, service } = setup();
    repository.findTarget.mockResolvedValue(
      targetRecord({ workspaceId: WORKSPACE_B_ID }),
    );

    await expect(
      service.create(makeActor(USER_OUTSIDER_ID), membership("editor"), {
        tripId: TRIP_A_ID,
        targetType: "journal_entry",
        targetId: ENTRY_ID,
        body: "Cross-tenant comment.",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("requires a reply's parent to belong to the same comment target", async () => {
    const { repository, service } = setup();
    repository.findTarget.mockResolvedValue(targetRecord());
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.findParent.mockResolvedValue(
      commentRecord({
        id: PARENT_ID,
        targetType: "itinerary_item",
        targetId: ITINERARY_ID,
        parentId: null,
      }),
    );

    await expect(
      service.create(makeActor(USER_EDITOR_ID), membership("editor"), {
        tripId: TRIP_A_ID,
        targetType: "journal_entry",
        targetId: ENTRY_ID,
        parentId: PARENT_ID,
        body: "Wrong thread.",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("sanitizes comment bodies before persist and response", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTarget.mockResolvedValue(targetRecord());
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.createComment.mockImplementation(
      async (_tx: unknown, data: { body: string }) =>
        commentRecord({ body: data.body, authorId: USER_EDITOR_ID }),
    );
    repository.createMentions.mockResolvedValue(undefined);
    repository.findComment.mockImplementation(async () =>
      commentRecord({
        body: "<p>Safe <strong>markup</strong></p><script>alert(1)</script>",
      }),
    );

    const created = await service.create(makeActor(USER_EDITOR_ID), membership("editor"), {
      tripId: TRIP_A_ID,
      targetType: "journal_entry",
      targetId: ENTRY_ID,
      body: "<p>Safe <strong>markup</strong></p><script>alert(1)</script>",
    });
    const persisted = repository.createComment.mock.calls[0]?.[1] as { body: string };

    expect(persisted.body).toContain("<strong>markup</strong>");
    expect(persisted.body).not.toMatch(/script|alert/i);
    expect(created.body).not.toMatch(/script|alert/i);
  });

  it("only allows the author or an owner/admin to edit and delete a comment", async () => {
    const { repository, service } = setup();
    repository.findComment.mockResolvedValue(commentRecord());

    await expect(
      service.update(makeActor(USER_VIEWER_ID), membership("viewer"), COMMENT_ID, {
        body: "Hijacked.",
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.remove(makeActor(USER_VIEWER_ID), membership("viewer"), COMMENT_ID),
    ).rejects.toMatchObject({ status: 403 });

    repository.findComment.mockResolvedValue(commentRecord({ authorId: USER_OWNER_ID }));
    await expect(
      service.remove(makeActor(USER_EDITOR_ID), membership("editor"), COMMENT_ID),
    ).rejects.toMatchObject({ status: 403 });
  });
});
