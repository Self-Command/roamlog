import { afterEach, describe, expect, it, vi } from "vitest";

import { makeActor } from "../../../test/identity-fixtures.js";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ProviderEgressGuard } from "./provider-egress.js";
import { providerProblem } from "./provider-errors.js";
import { ProviderProbeService } from "./provider-probe.service.js";
import type { ProviderSecretService } from "./provider-secret.service.js";

const PROVIDER_ID = "01942f30-1200-7000-8000-000000000901";
const mailer = vi.hoisted(() => ({ verify: vi.fn(async () => true) }));

vi.mock("nodemailer", () => ({
  createTransport: () => ({
    verify: mailer.verify,
    close: vi.fn(),
  }),
}));

function setup(
  options: {
    fetch?: ReturnType<typeof vi.fn>;
    blocked?: boolean;
    row?: Record<string, unknown>;
    secrets?: Record<string, string>;
  } = {},
) {
  const prisma = {
    client: {
      providerConnection: {
        findUnique: vi.fn(
          async () =>
            options.row ?? {
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
            },
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  } as unknown as PrismaService;
  const secrets = {
    resolvePlaintext: vi.fn(async () => options.secrets ?? { apiKey: "geo-secret" }),
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
  mailer.verify.mockReset();
  mailer.verify.mockResolvedValue(true);
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

  it("marks the saved SMTP provider unhealthy when the relay rejects AUTH", async () => {
    mailer.verify.mockRejectedValueOnce(
      Object.assign(new Error("535 username and password not accepted"), {
        code: "EAUTH",
        responseCode: 535,
      }),
    );
    const { service, prisma } = setup({
      row: {
        id: PROVIDER_ID,
        group: "mail",
        adapter: "smtp",
        preset: "smtp",
        config: {
          from: "Roamlog <verify@example.com>",
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "mailer",
        },
        version: 3,
        deletedAt: null,
      },
      secrets: { password: "secret" },
    });

    const result = await service.probeSaved(makeActor(), PROVIDER_ID, 3);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Delivery",
        status: "fail",
        code: "AUTH_FAILED",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(
      prisma.client.providerConnection.updateMany as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthStatus: "unhealthy",
          lastErrorCode: "AUTH_FAILED",
        }),
      }),
    );
  });

  it("does not send an email during the SMTP provider probe", async () => {
    const { service } = setup({
      row: {
        id: PROVIDER_ID,
        group: "mail",
        adapter: "smtp",
        preset: "smtp",
        config: {
          from: "Roamlog <verify@example.com>",
          host: "smtp.example.com",
          port: 587,
          secure: false,
          user: "mailer",
        },
        version: 3,
        deletedAt: null,
      },
      secrets: { password: "secret" },
    });

    const result = await service.probeSaved(makeActor(), PROVIDER_ID, 3);

    expect(result.ok).toBe(true);
    expect(mailer.verify).toHaveBeenCalledTimes(1);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "Delivery", status: "pass" }),
    );
  });
});
