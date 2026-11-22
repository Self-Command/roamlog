import { describe, expect, it, vi } from "vitest";
import type { ProviderConnection, ProviderGroupResponse } from "@roamlog/contracts";
import { createPrismaClient } from "@roamlog/db";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { presentUser } from "../../../common/services/user-presenter.js";
import { WorkspaceAccessService } from "../../../common/services/workspace-access.service.js";
import type { AppConfigService } from "../../../config/app-config.service.js";
import { AuditService } from "../../audit/audit.service.js";
import { generateUuidV7 } from "../../auth/uuid.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { ProviderConfigService } from "../provider-config.service.js";
import {
  assertProviderImportKeyring,
  buildProviderImportConfig,
  ProviderImportService,
} from "../provider-import.service.js";
import { ProviderSecretService } from "../provider-secret.service.js";

function actor(): AuthenticatedActor {
  return {
    user: { id: "01a1ed11-d7c2-74a3-98ba-3b9bd84b706a" } as AuthenticatedActor["user"],
    ip: null,
    userAgent: "provider-import-test",
  };
}

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: "01a1ed11-d7c2-74a3-98ba-3b9bd84b706a",
    group: "places",
    adapter: "tencent",
    preset: "tencent",
    label: "腾讯地图",
    enabled: true,
    priority: 10,
    config: {},
    version: 2,
    secrets: [
      {
        field: "apiKey",
        hasValue: true,
        last4: "a1b2",
        version: 1,
      },
    ],
    health: {
      status: "unknown",
      lastCheckedAt: null,
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
    ...overrides,
  };
}

function group(providers: ProviderConnection[] = []): ProviderGroupResponse {
  return {
    group: "places",
    label: "地图服务",
    routingMode: "merge",
    maxAttempts: 3,
    cooldownSeconds: 30,
    version: 1,
    providers,
  };
}

describe("ProviderImportService", () => {
  it("fails closed when the current keyring is missing or malformed", () => {
    expect(() => assertProviderImportKeyring({})).toThrow(/keyring/);
    expect(() => assertProviderImportKeyring({ CONFIG_ENCRYPTION_KEY: "not-base64" })).toThrow(
      /keyring/,
    );
    expect(() =>
      assertProviderImportKeyring({
        CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      }),
    ).not.toThrow();
  });

  it("builds catalogue defaults for a Tencent key import", () => {
    expect(buildProviderImportConfig("tencent", "tencent")).toMatchObject({
      baseUrl: "https://apis.map.qq.com/ws",
      timeoutMs: 2_000,
      regions: ["cn"],
      dailyQuota: 0,
      cacheTtlSeconds: 900,
    });
    expect(buildProviderImportConfig("geoapify", "geoapify")).toMatchObject({
      baseUrl: "https://api.geoapify.com/v1/geocode/autocomplete",
      regions: ["global"],
    });
  });

  it("creates a provider and secret in one API-service call, then audits without plaintext", async () => {
    const providers = {
      getGroup: vi.fn(async () => group()),
      create: vi.fn(async () => connection()),
    };
    const secrets = { replace: vi.fn() };
    const audit = { record: vi.fn(async () => ({ id: "audit-1" })) };
    const importer = new ProviderImportService(
      providers as never,
      secrets as never,
      audit as never,
    );

    const result = await importer.importProvider(actor(), {
      group: "places",
      adapter: "tencent",
      preset: "tencent",
      label: "腾讯地图",
      priority: 10,
      secret: "test-key-a1b2",
      replaceSecret: false,
      dryRun: false,
    });

    expect(result).toMatchObject({
      status: "created",
      last4: "a1b2",
      priority: 10,
    });
    expect(providers.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: actor().user.id }) }),
      expect.objectContaining({
        secrets: { apiKey: "test-key-a1b2" },
        config: expect.objectContaining({ baseUrl: "https://apis.map.qq.com/ws" }),
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("test-key-a1b2");
  });

  it("does not replace an existing secret without --replace-secret", async () => {
    const providers = {
      getGroup: vi.fn(async () => group([connection()])),
      create: vi.fn(),
    };
    const secrets = { replace: vi.fn() };
    const audit = { record: vi.fn() };
    const importer = new ProviderImportService(
      providers as never,
      secrets as never,
      audit as never,
    );

    await expect(
      importer.importProvider(actor(), {
        group: "places",
        adapter: "tencent",
        preset: "tencent",
        label: "腾讯地图",
        priority: 10,
        secret: "different-key",
        replaceSecret: false,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ status: "unchanged", last4: "a1b2" });
    expect(secrets.replace).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("replaces an existing secret only when explicitly requested", async () => {
    const providers = {
      getGroup: vi.fn(async () => group([connection()])),
      create: vi.fn(),
    };
    const secrets = {
      replace: vi.fn(async () => ({
        field: "apiKey",
        hasValue: true,
        last4: "c3d4",
        version: 2,
      })),
    };
    const audit = { record: vi.fn(async () => ({ id: "audit-2" })) };
    const importer = new ProviderImportService(
      providers as never,
      secrets as never,
      audit as never,
    );

    await expect(
      importer.importProvider(actor(), {
        group: "places",
        adapter: "tencent",
        preset: "tencent",
        label: "腾讯地图",
        priority: 10,
        secret: "replacement-c3d4",
        replaceSecret: true,
        dryRun: false,
      }),
    ).resolves.toMatchObject({ status: "updated", last4: "c3d4" });
    expect(secrets.replace).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 2, value: "replacement-c3d4" }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("replacement-c3d4");
  });

  it("never writes during a dry run", async () => {
    const providers = { getGroup: vi.fn(async () => group()), create: vi.fn() };
    const secrets = { replace: vi.fn() };
    const audit = { record: vi.fn() };
    const importer = new ProviderImportService(
      providers as never,
      secrets as never,
      audit as never,
    );

    await expect(
      importer.importProvider(actor(), {
        group: "places",
        adapter: "geoapify",
        preset: "geoapify",
        label: "Geoapify",
        secret: "dry-run-key",
        replaceSecret: false,
        dryRun: true,
      }),
    ).resolves.toMatchObject({ status: "dry_run", providerId: null });
    expect(providers.create).not.toHaveBeenCalled();
    expect(secrets.replace).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.ROAMLOG_TEST_DATABASE_URL)(
  "ProviderImportService against PostgreSQL",
  () => {
    it("creates, replays idempotently, replaces on request, and keeps plaintext out of audit rows", async () => {
      const prisma = createPrismaClient({
        connectionString: process.env.ROAMLOG_TEST_DATABASE_URL,
      });
      const prismaService = { client: prisma } as unknown as PrismaService;
      const config = {
        databaseUrl: process.env.ROAMLOG_TEST_DATABASE_URL,
        configEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
        configEncryptionKeys: undefined,
      } as AppConfigService;
      const audit = new AuditService(
        prismaService,
        new WorkspaceAccessService(prismaService),
        new PermissionService(),
      );
      const secretService = new ProviderSecretService(prismaService, audit, config);
      const providers = new ProviderConfigService(prismaService, audit, secretService);
      const importer = new ProviderImportService(providers, secretService, audit);

      const actorRow = await prisma.user.create({
        data: {
          id: generateUuidV7(),
          email: `provider-import-${generateUuidV7()}@roamlog.test`,
          emailVerified: true,
          name: "Provider Import E2E Admin",
          platformRole: "super_admin",
          status: "active",
        },
      });
      const actor: AuthenticatedActor = {
        user: presentUser(actorRow!),
        ip: null,
        userAgent: "provider-import-e2e",
      };
      const label = `e2e-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const firstSecret = "integration-key-9999";
      const secondSecret = "integration-key-8888";
      let providerId: string | null = null;

      try {
        const created = await importer.importProvider(actor, {
          group: "places",
          adapter: "tencent",
          preset: "tencent",
          label,
          priority: 10,
          secret: firstSecret,
          replaceSecret: false,
          dryRun: false,
        });
        providerId = created.providerId;
        expect(created).toMatchObject({ status: "created", last4: "9999" });

        await expect(
          importer.importProvider(actor, {
            group: "places",
            adapter: "tencent",
            preset: "tencent",
            label,
            priority: 10,
            secret: secondSecret,
            replaceSecret: false,
            dryRun: false,
          }),
        ).resolves.toMatchObject({ status: "unchanged", last4: "9999" });

        await expect(
          importer.importProvider(actor, {
            group: "places",
            adapter: "tencent",
            preset: "tencent",
            label,
            priority: 10,
            secret: secondSecret,
            replaceSecret: true,
            dryRun: false,
          }),
        ).resolves.toMatchObject({ status: "updated", last4: "8888" });

        const audits = await prisma.auditLog.findMany({
          where: { targetId: providerId! },
          select: { metadata: true },
        });
        expect(audits.length).toBeGreaterThanOrEqual(3);
        expect(JSON.stringify(audits)).not.toContain(firstSecret);
        expect(JSON.stringify(audits)).not.toContain(secondSecret);
      } finally {
        if (providerId) {
          await prisma.auditLog.deleteMany({ where: { targetId: providerId } });
          await prisma.providerConnection.deleteMany({ where: { id: providerId } });
        }
        await prisma.auditLog.deleteMany({ where: { actorId: actorRow.id } });
        await prisma.user.deleteMany({ where: { id: actorRow.id } });
        await prisma.$disconnect();
      }
    }, 30_000);
  },
);
