import { describe, expect, it, vi } from "vitest";

import {
  NOW,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  WORKSPACE_A_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";
import { AdminReportsService } from "../admin-reports.service.js";

const TRIP_ID = "01942f30-1200-7000-8000-000000000931";
const REPORT_ID = "01942f30-1200-7000-8000-000000000932";
const ACTION_ID = "01942f30-1200-7000-8000-000000000933";

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    workspaceId: WORKSPACE_A_ID,
    targetType: "trip",
    targetId: TRIP_ID,
    reason: "spam",
    detail: "广告刷屏",
    reporterId: USER_OWNER_ID,
    status: "open",
    resolvedById: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: NOW,
    ...overrides,
  };
}

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    reportId: REPORT_ID,
    actorId: USER_ADMIN_ID,
    action: "warn",
    note: "first warning",
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  const client = {
    report: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    moderationAction: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
    trip: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    journalEntry: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    comment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    media: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    workspace: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  } as Record<string, unknown>;
  const clientWithTx = client as typeof client & {
    $transaction: ReturnType<typeof vi.fn>;
  };
  clientWithTx.$transaction = vi.fn(async (work: (tx: typeof client) => unknown) => work(client));
  const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
  const service = new AdminReportsService(
    { client: clientWithTx } as never,
    audit as never,
  );
  return { client: clientWithTx, audit, service };
}

function tripMock(client: Record<string, unknown>) {
  return client.trip as { updateMany: ReturnType<typeof vi.fn> };
}

function snapshotMocks(client: ReturnType<typeof setup>["client"]) {
  (client.trip as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
    {
      id: TRIP_ID,
      workspaceId: WORKSPACE_A_ID,
      title: "Kyoto in November",
      createdById: USER_OWNER_ID,
      deletedAt: null,
      moderatedAt: null,
    },
  ]);
  (client.workspace as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
    { id: WORKSPACE_A_ID, name: "Studio" },
  ]);
  (client.user as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
    { id: USER_OWNER_ID, name: "Owner" },
  ]);
  (client.report as { groupBy: ReturnType<typeof vi.fn> }).groupBy.mockResolvedValue([
    {
      targetType: "trip",
      targetId: TRIP_ID,
      _count: { _all: 2 },
      _max: { createdAt: NOW },
    },
  ]);
}

describe("AdminReportsService.list", () => {
  it("applies every queue filter and the default createdAt desc order", async () => {
    const { client, service } = setup();
    snapshotMocks(client);
    (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      reportRow(),
    ]);

    const page = await service.list(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), {
      status: "open",
      targetType: "trip",
      reason: "spam",
      workspaceId: WORKSPACE_A_ID,
      from: "2026-11-01",
      to: "2026-11-19",
      limit: "20",
    });

    const query = (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mock
      .calls[0]?.[0] as { where: Record<string, unknown>; orderBy: unknown[]; take: number };
    expect(query.where).toMatchObject({
      status: "open",
      targetType: "trip",
      reason: "spam",
      workspaceId: WORKSPACE_A_ID,
    });
    expect(query.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    expect(query.take).toBe(21);
    expect(page.items[0]).toMatchObject({
      reportCount: 2,
      target: { title: "Kyoto in November", authorName: "Owner", workspaceName: "Studio" },
    });
  });

  it("returns an empty page rather than fabricating queue rows", async () => {
    const { service } = setup();
    const page = await service.list(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), {});
    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it("rejects a non-admin actor at the service boundary", async () => {
    const { service } = setup();
    await expect(
      service.list(makeActor(USER_OWNER_ID, { platformRole: "user" }), {}),
    ).rejects.toMatchObject({ status: 403, response: { code: "ADMIN_ACTION_FORBIDDEN" } });
  });
});

describe("AdminReportsService.detail", () => {
  it("returns the snapshot, every sibling report and the action history", async () => {
    const { client, service } = setup();
    snapshotMocks(client);
    (client.report as { findUnique: ReturnType<typeof vi.fn> }).findUnique.mockResolvedValue(
      reportRow(),
    );
    (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      reportRow(),
      reportRow({ id: "01942f30-1200-7000-8000-000000000934", reporterId: USER_ADMIN_ID }),
    ]);
    (client.moderationAction as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      actionRow(),
    ]);

    const detail = await service.detail(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      REPORT_ID,
    );

    expect(detail.reports).toHaveLength(2);
    expect(detail.actions[0]).toMatchObject({ action: "warn", note: "first warning" });
    expect(detail.report.target.title).toBe("Kyoto in November");
  });
});

describe("AdminReportsService.resolve", () => {
  it("remove: marks the target moderated + soft-deleted, closes the report and audits", async () => {
    const { client, audit, service } = setup();
    snapshotMocks(client);
    (client.report as { findUnique: ReturnType<typeof vi.fn> }).findUnique.mockResolvedValue(
      reportRow(),
    );
    (client.report as { update: ReturnType<typeof vi.fn> }).update.mockResolvedValue(
      reportRow({ status: "resolved" }),
    );
    (client.moderationAction as { create: ReturnType<typeof vi.fn> }).create.mockResolvedValue(
      actionRow({ action: "remove" }),
    );
    (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      reportRow({ status: "resolved" }),
    ]);

    const response = await service.resolve(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      REPORT_ID,
      { action: "remove", note: "广告" },
    );

    expect(tripMock(client).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TRIP_ID },
        data: expect.objectContaining({
          moderatedById: USER_ADMIN_ID,
          deletedAt: expect.any(Date),
          moderatedAt: expect.any(Date),
        }),
      }),
    );
    expect((client.report as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "resolved",
          resolvedById: USER_ADMIN_ID,
          resolutionNote: "广告",
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.report.resolved",
        targetType: "report",
        targetId: REPORT_ID,
        workspaceId: WORKSPACE_A_ID,
        metadata: { reportId: REPORT_ID, action: "remove", targetType: "trip" },
      }),
      expect.anything(),
    );
    expect(JSON.stringify(audit.record.mock.calls[0]?.[0])).not.toContain("广告刷屏");
    expect(response.report.status).toBe("resolved");
    expect(response.action.action).toBe("remove");
  });

  it("restore only clears content that was actually moderated", async () => {
    const { client, service } = setup();
    snapshotMocks(client);
    (client.report as { findUnique: ReturnType<typeof vi.fn> }).findUnique.mockResolvedValue(
      reportRow({ status: "open" }),
    );
    (client.report as { update: ReturnType<typeof vi.fn> }).update.mockResolvedValue(
      reportRow({ status: "resolved" }),
    );
    (client.moderationAction as { create: ReturnType<typeof vi.fn> }).create.mockResolvedValue(
      actionRow({ action: "restore" }),
    );
    (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      reportRow({ status: "resolved" }),
    ]);

    await service.resolve(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), REPORT_ID, {
      action: "restore",
    });

    expect(tripMock(client).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TRIP_ID, moderatedAt: { not: null } },
        data: { deletedAt: null, moderatedAt: null, moderatedById: null },
      }),
    );
  });

  it("dismiss closes the report as dismissed without touching the target", async () => {
    const { client, service } = setup();
    snapshotMocks(client);
    (client.report as { findUnique: ReturnType<typeof vi.fn> }).findUnique.mockResolvedValue(
      reportRow(),
    );
    (client.report as { update: ReturnType<typeof vi.fn> }).update.mockResolvedValue(
      reportRow({ status: "dismissed" }),
    );
    (client.moderationAction as { create: ReturnType<typeof vi.fn> }).create.mockResolvedValue(
      actionRow({ action: "dismiss" }),
    );
    (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      reportRow({ status: "dismissed" }),
    ]);

    const response = await service.resolve(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      REPORT_ID,
      { action: "dismiss" },
    );

    expect(tripMock(client).updateMany).not.toHaveBeenCalled();
    expect(response.report.status).toBe("dismissed");
  });

  it("warn closes the report as resolved and keeps the action note", async () => {
    const { client, service } = setup();
    snapshotMocks(client);
    (client.report as { findUnique: ReturnType<typeof vi.fn> }).findUnique.mockResolvedValue(
      reportRow(),
    );
    (client.report as { update: ReturnType<typeof vi.fn> }).update.mockResolvedValue(
      reportRow({ status: "resolved" }),
    );
    (client.moderationAction as { create: ReturnType<typeof vi.fn> }).create.mockResolvedValue(
      actionRow({ action: "warn", note: "不要太冲" }),
    );
    (client.report as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      reportRow({ status: "resolved" }),
    ]);

    const response = await service.resolve(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      REPORT_ID,
      { action: "warn", note: "不要太冲" },
    );

    expect(tripMock(client).updateMany).not.toHaveBeenCalled();
    expect(response.action).toMatchObject({ action: "warn", note: "不要太冲" });
  });

  it("returns 409 REPORT_ALREADY_RESOLVED when the report is already closed", async () => {
    const { client, service } = setup();
    (client.report as { findUnique: ReturnType<typeof vi.fn> }).findUnique.mockResolvedValue(
      reportRow({ status: "resolved" }),
    );

    await expect(
      service.resolve(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), REPORT_ID, {
        action: "remove",
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "REPORT_ALREADY_RESOLVED" },
    });
    expect(tripMock(client).updateMany).not.toHaveBeenCalled();
  });

  it("refuses restore for an analyst without admin:content:restore", async () => {
    const { service } = setup();
    await expect(
      service.resolve(makeActor(USER_ADMIN_ID, { platformRole: "analyst" }), REPORT_ID, {
        action: "restore",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});