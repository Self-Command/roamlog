import { describe, expect, it, vi } from "vitest";

import { makeActor } from "../../../test/identity-fixtures.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { AuditService } from "../audit/audit.service.js";
import { ProviderModelService } from "./provider-model.service.js";

const PROVIDER_ID = "01942f30-1200-7000-8000-000000000901";
const MODEL_ID = "01942f30-1200-7000-8000-000000000902";

function model(overrides: Record<string, unknown> = {}) {
  return {
    id: MODEL_ID,
    providerId: PROVIDER_ID,
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    ownedBy: "openai",
    enabled: true,
    isDefault: false,
    capabilities: {},
    discoveredAt: new Date("2026-11-22T00:00:00.000Z"),
    updatedAt: new Date("2026-11-22T00:00:00.000Z"),
    ...overrides,
  };
}

function setup(overrides: { version?: number; model?: Record<string, unknown> } = {}) {
  const provider = {
    id: PROVIDER_ID,
    group: "ai",
    version: overrides.version ?? 4,
    deletedAt: null,
  };
  const current = model(overrides.model);
  const tx = {
    providerModel: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...current,
        ...data,
        updatedAt: new Date("2026-11-22T00:01:00.000Z"),
      })),
    },
    providerConnection: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = {
    client: {
      providerConnection: { findUnique: vi.fn(async () => provider) },
      providerModel: { findUnique: vi.fn(async () => current) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    },
  } as unknown as PrismaService;
  const audit = { record: vi.fn(async () => ({ id: "audit-id" })) } as unknown as AuditService;
  const runtime = { invalidate: vi.fn(async () => undefined) };
  return {
    service: new ProviderModelService(prisma, audit, runtime as never),
    tx,
    runtime,
    audit,
  };
}

describe("ProviderModelService", () => {
  it("selects one default model atomically and invalidates the AI runtime", async () => {
    const { service, tx, runtime } = setup();

    const result = await service.update(makeActor(), PROVIDER_ID, "gpt-4o", {
      isDefault: true,
      expectedVersion: 4,
    });

    expect(tx.providerModel.updateMany).toHaveBeenCalledWith({
      where: { providerId: PROVIDER_ID, isDefault: true, NOT: { id: MODEL_ID } },
      data: { isDefault: false },
    });
    expect(tx.providerConnection.updateMany).toHaveBeenCalledWith({
      where: { id: PROVIDER_ID, version: 4, deletedAt: null },
      data: { version: { increment: 1 }, updatedById: expect.any(String) },
    });
    expect(result.isDefault).toBe(true);
    expect(runtime.invalidate).toHaveBeenCalledWith("ai");
  });

  it("rejects a stale provider version without writing", async () => {
    const { service, tx } = setup({ version: 5 });

    await expect(
      service.update(makeActor(), PROVIDER_ID, "gpt-4o", {
        enabled: false,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_VERSION_CONFLICT" });
    expect(tx.providerModel.update).not.toHaveBeenCalled();
  });

  it("does not allow the current default model to be disabled", async () => {
    const { service, tx } = setup({ model: { isDefault: true } });

    await expect(
      service.update(makeActor(), PROVIDER_ID, "gpt-4o", {
        enabled: false,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
    expect(tx.providerModel.update).not.toHaveBeenCalled();
  });
});
