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

  function auditRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "01942f30-1200-7000-8000-000000000501",
      actorId: USER_ADMIN_ID,
      actorType: "admin",
      action: "admin.user.updated",
      targetType: "user",
      targetId: "01942f30-1200-7000-8000-000000000502",
      workspaceId: null,
      ip: "127.0.0.1",
      userAgent: "vitest",
      metadata: { source: "test" },
      createdAt: NOW,
      ...overrides,
    };
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

  it("lists and exports legacy UUIDv4 audit records without rewriting their id", async () => {
    const { prisma, service } = setup();
    const legacyId = "9f1d7a2e-3b4c-4d5e-8f60-123456789abc";
    prisma.client.auditLog.findMany.mockResolvedValue([
      {
        id: legacyId,
        actorId: null,
        actorType: "system",
        action: "admin.user.updated",
        targetType: "user",
        targetId: "01942f30-1200-7000-8000-000000000503",
        workspaceId: null,
        ip: null,
        userAgent: null,
        metadata: { source: "legacy" },
        createdAt: NOW,
      },
    ]);

    const actor = makeActor(USER_ADMIN_ID, { platformRole: "analyst" });
    const page = await service.list(actor, {});
    const csv = await service.exportCsv(actor, {});

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(legacyId);
    expect(csv).toContain(`"${legacyId}"`);
  });

  it("uses text contains for q and shares the same filter between list and export", async () => {
    const { prisma, service } = setup();
    prisma.client.auditLog.findMany.mockResolvedValue([auditRow()]);
    const actor = makeActor(USER_ADMIN_ID, { platformRole: "analyst" });

    const page = await service.list(actor, { q: "admin.user.updated" });
    await service.exportCsv(actor, { q: "admin.user.updated" });

    expect(page.items).toHaveLength(1);
    const listWhere = prisma.client.auditLog.findMany.mock.calls[0]?.[0]?.where;
    const exportWhere = prisma.client.auditLog.findMany.mock.calls[1]?.[0]?.where;
    const expected = {
      OR: [
        { action: { contains: "admin.user.updated" } },
        { targetType: { contains: "admin.user.updated" } },
      ],
    };
    expect(listWhere).toEqual(expected);
    expect(exportWhere).toEqual(expected);
  });

  it("uses exact UUID equality when q is an identifier", async () => {
    const { prisma, service } = setup();
    prisma.client.auditLog.findMany.mockResolvedValue([]);
    const searchedId = "9f1d7a2e-3b4c-4d5e-8f60-123456789abc";

    await service.exportCsv(makeActor(USER_ADMIN_ID, { platformRole: "analyst" }), {
      q: searchedId,
    });

    expect(prisma.client.auditLog.findMany.mock.calls[0]?.[0]?.where).toEqual({
      OR: [
        { action: { contains: searchedId } },
        { targetType: { contains: searchedId } },
        { actorId: { equals: searchedId } },
        { targetId: { equals: searchedId } },
      ],
    });
  });

  it("neutralises spreadsheet formulas in exported values", async () => {
    const { prisma, service } = setup();
    prisma.client.auditLog.findMany.mockResolvedValue([
      auditRow({ action: '=HYPERLINK("https://attacker.invalid")' }),
    ]);

    const csv = await service.exportCsv(makeActor(USER_ADMIN_ID, { platformRole: "analyst" }), {});

    expect(csv).toContain(`"'=HYPERLINK(""https://attacker.invalid"")"`);
  });

  it("still rejects audit ids that are not UUIDs", async () => {
    const { prisma, service } = setup();
    prisma.client.auditLog.findMany.mockResolvedValue([
      {
        id: "not-a-uuid",
        actorId: null,
        actorType: "system",
        action: "admin.user.updated",
        targetType: "user",
        targetId: "01942f30-1200-7000-8000-000000000503",
        workspaceId: null,
        ip: null,
        userAgent: null,
        metadata: {},
        createdAt: NOW,
      },
    ]);

    await expect(
      service.list(makeActor(USER_ADMIN_ID, { platformRole: "analyst" }), {}),
    ).rejects.toThrow();
  });
});
