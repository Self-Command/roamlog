import { describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../prisma/prisma.service.js";
import { ProviderHealthService } from "./provider-health.service.js";

const PROVIDER_ID = "01942f30-1200-7000-8000-000000000777";

function setup() {
  const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
  const prisma = {
    client: { providerConnection: { updateMany } },
  } as unknown as PrismaService;
  return { service: new ProviderHealthService(prisma), updateMany };
}

describe("ProviderHealthService", () => {
  it("marks a permanently failing provider unhealthy with a visible code", async () => {
    const { service, updateMany } = setup();

    await service.recordFailure(PROVIDER_ID, {
      code: "AUTH_FAILED",
      retryable: false,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: PROVIDER_ID, deletedAt: null },
      data: expect.objectContaining({
        healthStatus: "unhealthy",
        lastErrorCode: "AUTH_FAILED",
        consecutiveFailures: { increment: 1 },
      }),
    });
  });

  it("marks retryable failures degraded and clears the error on success", async () => {
    const { service, updateMany } = setup();

    await service.recordFailure(PROVIDER_ID, {
      code: "CONNECTION_FAILED",
      retryable: true,
    });
    await service.recordSuccess(PROVIDER_ID);

    const calls = updateMany.mock.calls as unknown as Array<
      [{ data: Record<string, unknown>; where: Record<string, unknown> }]
    >;
    expect(calls[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ healthStatus: "degraded" }),
      }),
    );
    expect(calls[1]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "healthy",
          lastErrorCode: null,
          consecutiveFailures: 0,
          cooldownUntil: null,
        }),
      }),
    );
  });
});
