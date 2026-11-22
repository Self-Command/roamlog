import { afterEach, describe, expect, it, vi } from "vitest";

import { makeActor } from "../../../test/identity-fixtures.js";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ProviderEgressGuard } from "./provider-egress.js";
import { providerProblem } from "./provider-errors.js";
import { ProviderProbeService } from "./provider-probe.service.js";
import type { ProviderSecretService } from "./provider-secret.service.js";

const PROVIDER_ID = "01942f30-1200-7000-8000-000000000901";

function setup(options: { fetch?: ReturnType<typeof vi.fn>; blocked?: boolean } = {}) {
  const prisma = {
    client: {
      providerConnection: {
        findUnique: vi.fn(async () => ({
          id: PROVIDER_ID,
          group: "places",
          adapter: "geoapify",
          preset: "geoapify",
          config: {
            baseUrl: "https://api.geoapify.com/v1/geocode/autocomplete",
            regions: ["global"],
          },
          version: 3,
          deletedAt: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  } as unknown as PrismaService;
  const secrets = {
    resolvePlaintext: vi.fn(async () => ({ apiKey: "geo-secret" })),
  } as unknown as ProviderSecretService;
  const egress = {
    assertAllowed: options.blocked
      ? vi.fn(async () => {
          throw providerProblem("PROVIDER_EGRESS_BLOCKED");
        })
      : vi.fn(async () => undefined),
  } as unknown as ProviderEgressGuard;
  const audit = { record: vi.fn(async () => ({ id: "audit-id" })) } as unknown as AuditService;
  const fetchMock = options.fetch ?? vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return {
    service: new ProviderProbeService(prisma, secrets, egress, audit),
    prisma,
    egress,
    audit,
    fetchMock,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProviderProbeService", () => {
  it("probes a draft AI endpoint with the supplied key without persisting it", async () => {
    const { service, fetchMock, audit } = setup({
      fetch: vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    });

    const result = await service.probeDraft(makeActor(), {
      group: "ai",
      adapter: "openai-chat",
      preset: "openai",
      config: { baseUrl: "https://api.openai.com/v1" },
      secrets: { apiKey: "sk-draft" },
    });

    expect(result.ok).toBe(true);
    expect(result.providerId).toBeNull();
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "Models", status: "pass" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.openai.com/v1/models"),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer sk-draft" }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.provider.probed" }),
    );
    expect(JSON.stringify((audit.record as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      "sk-draft",
    );
  });

  it("records a safe failure and provider health when a saved probe is rejected", async () => {
    const { service, prisma } = setup({
      fetch: vi.fn(async () => new Response("upstream secret body", { status: 401 })),
    });

    const result = await service.probeSaved(makeActor(), PROVIDER_ID, 3);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "Search", status: "fail" }),
    );
    expect(JSON.stringify(result)).not.toContain("upstream secret body");
    expect(
      prisma.client.providerConnection.updateMany as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "unhealthy",
          lastErrorCode: "PROVIDER_PROBE_FAILED",
        }),
      }),
    );
  });

  it("fails closed when the egress guard blocks a saved endpoint", async () => {
    const { service } = setup({ blocked: true });

    await expect(service.probeSaved(makeActor(), PROVIDER_ID, 3)).rejects.toMatchObject({
      code: "PROVIDER_EGRESS_BLOCKED",
    });
  });
});
