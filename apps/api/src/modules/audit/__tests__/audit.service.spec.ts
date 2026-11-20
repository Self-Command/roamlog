import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import { AuditService } from "../audit.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

describe("AuditService", () => {
  function setup() {
    const prisma = {
      client: {
        auditLog: {
          create: vi.fn(),
          findMany: vi.fn(),
        },
      },
    };
    const access = { requireMembership: vi.fn() };
    const service = new AuditService(prisma as never, access as never, new PermissionService());
    return { prisma, access, service };
  }

  it("appends actor, tenant, request, and metadata to audit records", async () => {
    const { prisma, service } = setup();
    prisma.client.auditLog.create.mockResolvedValue({ id: "audit" });

    await service.record({
      actorId: USER_ADMIN_ID,
      actorType: "user",
      action: "member.role_updated",
      targetType: "member",
      targetId: USER_VIEWER_ID,
      workspaceId: WORKSPACE_A_ID,
      ip: "127.0.0.1",
      userAgent: "vitest",
      metadata: { role: "editor" },
    });

    expect(prisma.client.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: USER_ADMIN_ID,
        action: "member.role_updated",
        workspaceId: WORKSPACE_A_ID,
        metadata: { role: "editor" },
      }),
      select: { id: true },
    });
  });

  it("blocks Viewers from reading the audit log", async () => {
    const { access, service } = setup();
    access.requireMembership.mockResolvedValue({
      role: "viewer",
      workspaceId: WORKSPACE_A_ID,
      userId: USER_VIEWER_ID,
      status: "active",
      id: "member",
      joinedAt: NOW,
      invitedById: null,
      createdAt: NOW,
      updatedAt: NOW,
      workspaceName: "Atlas Studio",
    });

    await expect(
      service.listWorkspace(makeActor(USER_VIEWER_ID), WORKSPACE_A_ID, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("returns a contract-shaped audit page for an Admin", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      role: "admin",
      workspaceId: WORKSPACE_A_ID,
      userId: USER_ADMIN_ID,
      status: "active",
      id: "member",
      joinedAt: NOW,
      invitedById: null,
      createdAt: NOW,
      updatedAt: NOW,
      workspaceName: "Atlas Studio",
    });
    prisma.client.auditLog.findMany.mockResolvedValue([
      {
        id: "01942f30-1200-7000-8000-000000000501",
        actorId: USER_ADMIN_ID,
        actorType: "user",
        action: "workspace.updated",
        targetType: "workspace",
        targetId: WORKSPACE_A_ID,
        workspaceId: WORKSPACE_A_ID,
        ip: null,
        userAgent: null,
        metadata: {},
        createdAt: NOW,
      },
    ]);

    const page = await service.listWorkspace(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, {});

    expect(page.items[0]).toMatchObject({ action: "workspace.updated" });
    expect(page.hasMore).toBe(false);
  });

  it("keeps a non-RFC PostgreSQL uuid readable in the workspace audit page", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      role: "admin",
      workspaceId: WORKSPACE_A_ID,
      userId: USER_ADMIN_ID,
      status: "active",
      id: "member",
      joinedAt: NOW,
      invitedById: null,
      createdAt: NOW,
      updatedAt: NOW,
      workspaceName: "Atlas Studio",
    });
    // The AI planner writes its hex `runId` into `AuditLog.targetId` (a
    // PostgreSQL `uuid` column); PostgreSQL normalises it to this variant-`f`
    // value, which RFC 4122 rejects. The read path must still return it.
    const variantTargetId = "726d652a-fcfc-877c-f34f-593a6ec94c59";
    prisma.client.auditLog.findMany.mockResolvedValue([
      {
        id: "01a1f7f7-42b3-75d3-9e74-273039e92fec",
        actorId: USER_ADMIN_ID,
        actorType: "user",
        action: "ai.tool_call",
        targetType: "ai_tool",
        targetId: variantTargetId,
        workspaceId: WORKSPACE_A_ID,
        ip: null,
        userAgent: null,
        metadata: { runId: "run" },
        createdAt: NOW,
      },
    ]);

    const page = await service.listWorkspace(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, {});

    expect(page.items[0]).toMatchObject({
      action: "ai.tool_call",
      targetId: variantTargetId,
    });
  });
});
