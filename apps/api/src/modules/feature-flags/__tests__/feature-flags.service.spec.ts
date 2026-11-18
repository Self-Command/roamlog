import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  NOW,
  USER_ADMIN_ID,
  WORKSPACE_A_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";
import { FeatureFlagsService } from "../feature-flags.service.js";

function flagRecord(overrides: Record<string, unknown> = {}) {
  return {
    key: "trips.map",
    description: "Map view",
    enabled: false,
    rolloutPercentage: 0,
    rules: {},
    updatedById: USER_ADMIN_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("FeatureFlagsService", () => {
  function setup() {
    const prisma = {
      client: {
        featureFlag: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new FeatureFlagsService(prisma as never, audit as never);
    return { prisma, audit, service };
  }

  it("lists flags ordered by key", async () => {
    const { prisma, service } = setup();
    prisma.client.featureFlag.findMany.mockResolvedValue([flagRecord()]);

    const flags = await service.list();

    expect(flags[0]?.key).toBe("trips.map");
    expect(prisma.client.featureFlag.findMany).toHaveBeenCalledWith({
      orderBy: { key: "asc" },
    });
  });

  it("blocks admin from updating flags", async () => {
    const { service } = setup();

    await expect(
      service.update(
        makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
        "trips.map",
        { enabled: true },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets super_admin update enabled, rollout, and allowlist rules with audit", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.featureFlag.findUnique.mockResolvedValue(flagRecord());
    prisma.client.featureFlag.update.mockResolvedValue(
      flagRecord({ enabled: true, rolloutPercentage: 25 }),
    );

    const flag = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
      "trips.map",
      {
        enabled: true,
        rolloutPercentage: 25,
        rules: { workspaceIds: [WORKSPACE_A_ID] },
      },
    );

    expect(flag.enabled).toBe(true);
    expect(prisma.client.featureFlag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "trips.map" },
        data: expect.objectContaining({
          enabled: true,
          rolloutPercentage: 25,
          rules: { workspaceIds: [WORKSPACE_A_ID] },
          updatedById: USER_ADMIN_ID,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.feature_flag.updated",
        targetType: "feature_flag",
        metadata: expect.objectContaining({ key: "trips.map" }),
      }),
    );
  });

  it("rejects an invalid Workspace allowlist", async () => {
    const { service } = setup();

    await expect(
      service.update(
        makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
        "trips.map",
        { rules: { workspaceIds: ["not-a-uuid"] } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns 404 for an unknown flag", async () => {
    const { prisma, service } = setup();
    prisma.client.featureFlag.findUnique.mockResolvedValue(null);

    await expect(
      service.update(
        makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
        "missing.flag",
        { enabled: true },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates a flag with validation and an audit entry", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.featureFlag.findUnique.mockResolvedValue(null);
    prisma.client.featureFlag.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => flagRecord(data),
    );

    const created = await service.create(
      makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
      {
        key: "share.password.v3",
        description: "Share password v3",
        enabled: true,
        rolloutPercentage: 40,
        rules: { workspaceAllowlist: [WORKSPACE_A_ID] },
      },
    );

    expect(created.key).toBe("share.password.v3");
    expect(prisma.client.featureFlag.create).toHaveBeenCalledWith({
      data: {
        key: "share.password.v3",
        description: "Share password v3",
        enabled: true,
        rolloutPercentage: 40,
        rules: { workspaceAllowlist: [WORKSPACE_A_ID] },
        updatedById: USER_ADMIN_ID,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.feature_flag.created",
        targetType: "feature_flag",
        metadata: expect.objectContaining({ key: "share.password.v3", enabled: true }),
      }),
    );
  });

  it("rejects an invalid key, an out-of-range rollout, and a duplicate key", async () => {
    const { prisma, service } = setup();
    const actor = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" });

    await expect(
      service.create(actor, { key: "Bad Key!", description: "x" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(actor, { key: "valid.key", description: "x", rolloutPercentage: 140 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.client.featureFlag.findUnique.mockResolvedValue(flagRecord({ key: "valid.key" }));
    await expect(
      service.create(actor, { key: "valid.key", description: "x" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.client.featureFlag.create).not.toHaveBeenCalled();
  });

  it("blocks non super_admin from creating or deleting flags", async () => {
    const { service } = setup();
    const actor = makeActor(USER_ADMIN_ID, { platformRole: "admin" });

    await expect(
      service.create(actor, { key: "valid.key", description: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(actor, "trips.map")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("deletes an existing flag and audits it", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.featureFlag.findUnique.mockResolvedValue(flagRecord());
    prisma.client.featureFlag.delete.mockResolvedValue(flagRecord());

    const result = await service.remove(
      makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
      "trips.map",
    );

    expect(result.message).toContain("trips.map");
    expect(prisma.client.featureFlag.delete).toHaveBeenCalledWith({ where: { key: "trips.map" } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.feature_flag.deleted",
        targetType: "feature_flag",
        metadata: { key: "trips.map" },
      }),
    );
  });

  it("returns 404 when deleting an unknown flag", async () => {
    const { prisma, service } = setup();
    prisma.client.featureFlag.findUnique.mockResolvedValue(null);

    await expect(
      service.remove(makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }), "missing.flag"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.featureFlag.delete).not.toHaveBeenCalled();
  });
});
