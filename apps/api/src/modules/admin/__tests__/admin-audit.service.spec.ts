import { describe, expect, it, vi } from "vitest";

import { AdminAuditService } from "../admin-audit.service.js";
import { NOW, USER_ADMIN_ID, makeActor } from "../../../../test/identity-fixtures.js";

describe("AdminAuditService export", () => {
  function setup() {
    const prisma = {
      client: {
        auditLog: {
          findMany: vi.fn(),
        },
      },
    };
    const service = new AdminAuditService(prisma as never);
    return { prisma, service };
  }

  it("exports the documented CSV columns with UTF-8 encoding", async () => {
    const { prisma, service } = setup();
    prisma.client.auditLog.findMany.mockResolvedValue([
      {
        id: "01942f30-1200-7000-8000-000000000501",
        actorId: USER_ADMIN_ID,
        actorType: "admin",
        action: "admin.user.suspend",
        targetType: "user",
        targetId: "01942f30-1200-7000-8000-000000000502",
        workspaceId: null,
        ip: "127.0.0.1",
        userAgent: "vitest",
        metadata: { reason: "abuse report" },
        createdAt: NOW,
      },
    ]);

    const csv = await service.exportCsv(makeActor(USER_ADMIN_ID, { platformRole: "analyst" }), {
      actorType: "admin",
      from: "2026-11-01",
      sort: "createdAt:desc",
    });

    expect(csv.startsWith("\uFEFFid,createdAt,actorType,actorId,action,")).toBe(true);
    expect(csv).toContain('"admin.user.suspend"');
    expect(csv).toContain('"{""reason"":""abuse report""}"');
    expect(csv).toContain('"vitest"');
  });

  it("rejects support from exporting audit logs", async () => {
    const { prisma, service } = setup();

    await expect(
      service.exportCsv(makeActor(USER_ADMIN_ID, { platformRole: "support" }), {}),
    ).rejects.toMatchObject({
      response: { code: "ADMIN_ACTION_FORBIDDEN" },
    });
    expect(prisma.client.auditLog.findMany).not.toHaveBeenCalled();
  });
});
