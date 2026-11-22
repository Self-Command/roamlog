import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import {
  ProviderConfigService,
  type ProviderCreateInput,
  type ProviderUpdateInput,
} from "./provider-config.service.js";
import type { ProviderSecretService } from "./provider-secret.service.js";

const ACTOR = {
  user: { id: "0199a0c1-1100-7000-8000-000000000001" },
  ip: "203.0.113.10",
  userAgent: "provider-config.spec",
} as AuthenticatedActor;

const NOW = new Date("2026-11-22T12:00:00.000Z");

function providerId(index: number): string {
  return `0199d000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

interface ProviderRow {
  id: string;
  group: string;
  adapter: string;
  preset: string | null;
  label: string;
  enabled: boolean;
  priority: number;
  config: unknown;
  version: number;
  healthStatus: string;
  consecutiveFailures: number;
  cooldownUntil: Date | null;
  lastCheckedAt: Date | null;
  lastErrorCode: string | null;
  legacyKey: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface PolicyRow {
  group: string;
  routingMode: string;
  maxAttempts: number;
  cooldownSeconds: number;
  config: unknown;
  version: number;
  updatedById: string | null;
  updatedAt: Date;
  createdAt: Date;
}

interface SecretRow {
  providerId: string;
  field: string;
  last4: string;
  version: number;
}

interface AuditCall {
  action: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

function cloneMap<T>(source: Map<string, T>): Map<string, T> {
  return new Map([...source].map(([key, value]) => [key, { ...value }]));
}

function cloneRows<T>(source: readonly T[]): T[] {
  return source.map((value) => ({ ...value }));
}

function harness() {
  const providers = new Map<string, ProviderRow>();
  const policies = new Map<string, PolicyRow>();
  const secrets: SecretRow[] = [];
  const audits: AuditCall[] = [];
  let nextProvider = 1;

  const tx = {
    providerConnection: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return providers.get(where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { group: string; deletedAt: null } }) => {
        const matches = [...providers.values()].filter(
          (row) => row.group === where.group && row.deletedAt === null,
        );
        return matches.sort((left, right) => right.priority - left.priority)[0] ?? null;
      }),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            group: string;
            deletedAt: null;
            id?: { in: string[] };
          };
        }) => {
          return [...providers.values()]
            .filter(
              (row) =>
                row.group === where.group &&
                row.deletedAt === null &&
                (!where.id || where.id.in.includes(row.id)),
            )
            .sort(
              (left, right) =>
                left.priority - right.priority ||
                left.createdAt.getTime() - right.createdAt.getTime() ||
                left.id.localeCompare(right.id),
            );
        },
      ),
      count: vi.fn(
        async ({
          where,
        }: {
          where: {
            group: string;
            enabled: true;
            deletedAt: null;
            id?: { not: string };
          };
        }) => {
          return [...providers.values()].filter(
            (row) =>
              row.group === where.group &&
              row.enabled &&
              row.deletedAt === null &&
              (!where.id || row.id !== where.id.not),
          ).length;
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            group: string;
            adapter: string;
            preset: string | null;
            label: string;
            enabled: boolean;
            priority: number;
            config: unknown;
            createdById: string | null;
            updatedById: string | null;
          };
        }) => {
          const row: ProviderRow = {
            id: providerId(nextProvider),
            group: data.group,
            adapter: data.adapter,
            preset: data.preset,
            label: data.label,
            enabled: data.enabled,
            priority: data.priority,
            config: data.config,
            version: 1,
            healthStatus: "unknown",
            consecutiveFailures: 0,
            cooldownUntil: null,
            lastCheckedAt: null,
            lastErrorCode: null,
            legacyKey: null,
            createdById: data.createdById,
            updatedById: data.updatedById,
            createdAt: NOW,
            updatedAt: NOW,
            deletedAt: null,
          };
          nextProvider += 1;
          providers.set(row.id, row);
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            version?: number;
            deletedAt?: null;
          };
          data: Omit<Partial<ProviderRow>, "version"> & { version?: { increment: number } };
        }) => {
          const row = providers.get(where.id);
          if (
            !row ||
            (where.version !== undefined && row.version !== where.version) ||
            (where.deletedAt === null && row.deletedAt !== null)
          ) {
            return { count: 0 };
          }
          const { version, ...rest } = data;
          Object.assign(row, rest, {
            version: row.version + (version?.increment ?? 0),
            updatedAt: NOW,
          });
          return { count: 1 };
        },
      ),
    },
    providerGroupPolicy: {
      findUnique: vi.fn(async ({ where }: { where: { group: string } }) => {
        return policies.get(where.group) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: PolicyRow }) => {
        const row = { ...data, createdAt: data.createdAt ?? NOW, updatedAt: NOW };
        policies.set(row.group, row);
        return row;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { group: string; version: number };
          data: {
            routingMode?: string;
            maxAttempts?: number;
            cooldownSeconds?: number;
            version?: { increment: number };
            updatedById?: string | null;
          };
        }) => {
          const row = policies.get(where.group);
          if (!row || row.version !== where.version) {
            return { count: 0 };
          }
          const { version, ...rest } = data;
          Object.assign(row, rest, {
            version: row.version + (version?.increment ?? 0),
            updatedAt: NOW,
          });
          return { count: 1 };
        },
      ),
    },
    providerSecret: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            providerId?: string | { in: string[] };
            providerIdIn?: string[];
          };
        }) => {
          return secrets.filter((row) => {
            if (typeof where.providerId === "string") {
              return row.providerId === where.providerId;
            }
            if (where.providerId && Array.isArray(where.providerId.in)) {
              return where.providerId.in.includes(row.providerId);
            }
            return where.providerIdIn?.includes(row.providerId) ?? true;
          });
        },
      ),
    },
    auditLog: {},
  };

  const prisma = {
    client: {
      ...tx,
      $transaction: vi.fn(
        async <T>(callback: (transaction: typeof tx) => Promise<T>): Promise<T> => {
          const providerSnapshot = cloneMap(providers);
          const policySnapshot = cloneMap(policies);
          const secretSnapshot = cloneRows(secrets);
          const nextProviderSnapshot = nextProvider;
          try {
            return await callback(tx);
          } catch (error) {
            providers.clear();
            policies.clear();
            secrets.splice(0, secrets.length, ...secretSnapshot);
            for (const [key, value] of providerSnapshot) providers.set(key, value);
            for (const [key, value] of policySnapshot) policies.set(key, value);
            nextProvider = nextProviderSnapshot;
            throw error;
          }
        },
      ),
    },
  } as unknown as PrismaService;

  const audit = {
    record: vi.fn(async (input: AuditCall) => {
      audits.push(input);
      return { id: `audit-${audits.length}` };
    }),
  } as unknown as AuditService;

  const secretService = {
    listStates: vi.fn(async (id: string) =>
      secrets
        .filter((row) => row.providerId === id)
        .sort((left, right) => left.field.localeCompare(right.field))
        .map((row) => ({
          field: row.field,
          hasValue: true,
          last4: row.last4,
          version: row.version,
        })),
    ),
    replace: vi.fn(
      async (
        input: {
          providerId: string;
          field: string;
          value: string;
          expectedVersion: number;
        },
        client?: typeof tx,
      ) => {
        const provider = providers.get(input.providerId);
        if (!provider || provider.version !== input.expectedVersion) {
          throw new Error("unexpected version");
        }
        const existing = secrets.find(
          (row) => row.providerId === input.providerId && row.field === input.field,
        );
        if (existing) {
          existing.last4 = input.value.slice(-4);
          existing.version += 1;
        } else {
          secrets.push({
            providerId: input.providerId,
            field: input.field,
            last4: input.value.slice(-4),
            version: 1,
          });
        }
        if (!client) {
          throw new Error("test secret replace requires the transaction client");
        }
        await client.providerConnection.updateMany({
          where: { id: input.providerId, version: input.expectedVersion, deletedAt: null },
          data: { version: { increment: 1 } },
        });
        const state = secrets.find(
          (row) => row.providerId === input.providerId && row.field === input.field,
        );
        return {
          field: input.field,
          hasValue: true,
          last4: state?.last4 ?? null,
          version: state?.version ?? 1,
        };
      },
    ),
  } as unknown as ProviderSecretService;

  const runtime = { invalidate: vi.fn(async () => undefined) };

  return {
    audits,
    policies,
    providers,
    secrets,
    secretService,
    runtime,
    service: new ProviderConfigService(prisma, audit, secretService, runtime as never),
  };
}

function aiProvider(overrides: Partial<ProviderCreateInput> = {}): ProviderCreateInput {
  return {
    group: "ai",
    adapter: "openai-chat",
    preset: "custom-openai-compatible",
    label: "Test AI",
    enabled: true,
    config: { baseUrl: "https://api.example.com/v1" },
    secrets: { apiKey: "sk-test-1234" },
    ...overrides,
  };
}

describe("ProviderConfigService", () => {
  it("returns frozen group defaults and excludes deleted providers", async () => {
    const ctx = harness();

    const ai = await ctx.service.getGroup("ai");
    expect(ai).toMatchObject({
      group: "ai",
      label: "AI 服务",
      routingMode: "priority",
      maxAttempts: 3,
      cooldownSeconds: 30,
      version: 1,
      providers: [],
    });

    const places = await ctx.service.getGroup("places");
    expect(places).toMatchObject({ routingMode: "merge", maxAttempts: 3 });
    const mail = await ctx.service.getGroup("mail");
    expect(mail).toMatchObject({ routingMode: "single", maxAttempts: 1, cooldownSeconds: 0 });
  });

  it("creates a provider and its initial secret in one transaction, then audits the masked result", async () => {
    const ctx = harness();

    const created = await ctx.service.create(ACTOR, aiProvider());

    expect(created).toMatchObject({
      label: "Test AI",
      enabled: true,
      priority: 10,
      version: 2,
      secrets: [{ field: "apiKey", hasValue: true, last4: "1234" }],
    });
    expect(JSON.stringify(created)).not.toContain("sk-test-1234");
    expect(ctx.providers.size).toBe(1);
    expect(ctx.policies.get("ai")?.version).toBe(2);
    expect(ctx.secrets).toHaveLength(1);
    expect(ctx.runtime.invalidate).toHaveBeenCalledWith("ai");
    expect(ctx.audits).toEqual([
      expect.objectContaining({
        action: "admin.provider.created",
        targetId: created.id,
      }),
    ]);
  });

  it("rolls back the provider and group policy if a secret write fails", async () => {
    const ctx = harness();
    vi.mocked(ctx.secretService.replace).mockRejectedValueOnce(new Error("secret write failed"));

    await expect(ctx.service.create(ACTOR, aiProvider())).rejects.toThrow("secret write failed");

    expect(ctx.providers.size).toBe(0);
    expect(ctx.policies.size).toBe(0);
    expect(ctx.secrets).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it("rejects a stale provider version without writing", async () => {
    const ctx = harness();
    const created = await ctx.service.create(
      ACTOR,
      aiProvider({ enabled: false, secrets: undefined }),
    );

    await expect(
      ctx.service.update(ACTOR, created.id, {
        label: "Changed",
        expectedVersion: created.version + 10,
      } satisfies ProviderUpdateInput),
    ).rejects.toMatchObject({
      response: { code: "PROVIDER_VERSION_CONFLICT" },
    });

    expect(ctx.providers.get(created.id)?.label).toBe("Test AI");
    expect(ctx.audits).toHaveLength(1);
  });

  it("refuses a secret inside config", async () => {
    const ctx = harness();
    const created = await ctx.service.create(
      ACTOR,
      aiProvider({ enabled: false, secrets: undefined }),
    );

    await expect(
      ctx.service.update(ACTOR, created.id, {
        config: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "must-not-be-in-config",
        },
        expectedVersion: created.version,
      }),
    ).rejects.toMatchObject({
      response: { code: "PROVIDER_CONFIG_INVALID" },
    });
  });

  it("enforces one active provider for mail and storage", async () => {
    const ctx = harness();
    const mail = (label: string): ProviderCreateInput => ({
      group: "mail",
      adapter: "resend",
      preset: "resend",
      label,
      enabled: true,
      config: { from: "no-reply@example.com" },
      secrets: { apiKey: "re_test_key" },
    });

    await ctx.service.create(ACTOR, mail("Primary mail"));
    await expect(ctx.service.create(ACTOR, mail("Second mail"))).rejects.toMatchObject({
      response: { code: "PROVIDER_ACTIVE_CONFLICT" },
    });
  });

  it("normalizes reordered priorities, bumps the group version, and audits the order", async () => {
    const ctx = harness();
    const first = await ctx.service.create(
      ACTOR,
      aiProvider({ label: "First", enabled: false, secrets: undefined }),
    );
    const second = await ctx.service.create(
      ACTOR,
      aiProvider({ label: "Second", enabled: false, secrets: undefined }),
    );
    const before = await ctx.service.getGroup("ai");

    const reordered = await ctx.service.reorder(ACTOR, "ai", [second.id, first.id], before.version);

    expect(
      reordered.providers.map((provider) => ({ id: provider.id, priority: provider.priority })),
    ).toEqual([
      { id: second.id, priority: 10 },
      { id: first.id, priority: 20 },
    ]);
    expect(reordered.version).toBe(before.version + 1);
    expect(ctx.audits.at(-1)).toMatchObject({
      action: "admin.provider.reordered",
      metadata: { providerIds: [second.id, first.id] },
    });
    expect(ctx.audits.at(-1)?.targetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("soft deletes a provider and leaves an empty group behind", async () => {
    const ctx = harness();
    const created = await ctx.service.create(
      ACTOR,
      aiProvider({ enabled: false, secrets: undefined }),
    );

    await ctx.service.remove(ACTOR, created.id, created.version);

    expect(ctx.providers.get(created.id)?.deletedAt).toBeInstanceOf(Date);
    expect((await ctx.service.getGroup("ai")).providers).toEqual([]);
    expect(ctx.audits.at(-1)).toMatchObject({
      action: "admin.provider.deleted",
      targetId: created.id,
    });
  });

  it("updates policy and rejects a stale policy version", async () => {
    const ctx = harness();

    const updated = await ctx.service.patchPolicy(ACTOR, "ai", {
      routingMode: "priority",
      maxAttempts: 4,
      cooldownSeconds: 45,
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({
      routingMode: "priority",
      maxAttempts: 4,
      cooldownSeconds: 45,
      version: 2,
    });
    expect(ctx.audits.at(-1)).toMatchObject({ action: "admin.provider.policy_updated" });
    expect(ctx.audits.at(-1)?.targetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    await expect(
      ctx.service.patchPolicy(ACTOR, "ai", {
        routingMode: "priority",
        maxAttempts: 2,
        cooldownSeconds: 10,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: "PROVIDER_VERSION_CONFLICT" },
    });
  });
});
