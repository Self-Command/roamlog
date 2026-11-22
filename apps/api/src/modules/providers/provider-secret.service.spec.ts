import { randomBytes } from "node:crypto";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../config/app-config.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { SecretBox } from "../settings/secret-box.js";
import { ProviderSecretService } from "./provider-secret.service.js";

interface ProviderRow {
  id: string;
  version: number;
  deletedAt: Date | null;
}

interface SecretRow {
  id: string;
  providerId: string;
  field: string;
  ciphertext: string;
  last4: string | null;
  keyVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface SecretHistoryRow {
  id: string;
  providerId: string;
  field: string;
  ciphertext: string;
  last4: string | null;
  keyVersion: number;
  replacedAt: Date;
  expiresAt: Date;
}

function encryptionKey(): string {
  return randomBytes(32).toString("base64");
}

function harness(key = encryptionKey()) {
  const providers = new Map<string, ProviderRow>([
    ["provider-1", { id: "provider-1", version: 3, deletedAt: null }],
    ["provider-2", { id: "provider-2", version: 1, deletedAt: null }],
  ]);
  const secrets = new Map<string, SecretRow>();
  const history: SecretHistoryRow[] = [];
  let secretSequence = 0;
  let historySequence = 0;

  const secretKey = (providerId: string, field: string) => `${providerId}:${field}`;

  const tx = {
    providerConnection: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return providers.get(where.id) ?? null;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version: number; deletedAt: null };
          data: { version: { increment: number } };
        }) => {
          const provider = providers.get(where.id);
          if (
            !provider ||
            provider.version !== where.version ||
            provider.deletedAt !== where.deletedAt
          ) {
            return { count: 0 };
          }
          provider.version += data.version.increment;
          return { count: 1 };
        },
      ),
    },
    providerSecret: {
      findMany: vi.fn(async ({ where }: { where: { providerId: string } }) =>
        [...secrets.values()]
          .filter((row) => row.providerId === where.providerId)
          .sort((left, right) => left.field.localeCompare(right.field)),
      ),
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { providerId_field: { providerId: string; field: string } };
        }) => {
          return (
            secrets.get(
              secretKey(where.providerId_field.providerId, where.providerId_field.field),
            ) ?? null
          );
        },
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { providerId_field: { providerId: string; field: string } };
          create: Omit<SecretRow, "id" | "version" | "createdAt" | "updatedAt">;
          update: {
            ciphertext: string;
            last4: string | null;
            keyVersion: number;
            version: { increment: number };
          };
        }) => {
          const identity = secretKey(
            where.providerId_field.providerId,
            where.providerId_field.field,
          );
          const existing = secrets.get(identity);
          const now = new Date();
          if (existing) {
            existing.ciphertext = update.ciphertext;
            existing.last4 = update.last4;
            existing.keyVersion = update.keyVersion;
            existing.version += update.version.increment;
            existing.updatedAt = now;
            return existing;
          }
          secretSequence += 1;
          const row: SecretRow = {
            id: `secret-${secretSequence}`,
            ...create,
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          secrets.set(identity, row);
          return row;
        },
      ),
    },
    providerSecretHistory: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<SecretHistoryRow, "id" | "replacedAt"> & { replacedAt: Date };
        }) => {
          historySequence += 1;
          const row: SecretHistoryRow = {
            id: `history-${historySequence}`,
            ...data,
          };
          history.push(row);
          return row;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { expiresAt: { lte: Date } } }) => {
        const remaining = history.filter((row) => row.expiresAt > where.expiresAt.lte);
        const count = history.length - remaining.length;
        history.splice(0, history.length, ...remaining);
        return { count };
      }),
    },
  };

  const prisma = {
    client: {
      ...tx,
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    },
  } as unknown as PrismaService;
  const audit = {
    record: vi.fn(async () => ({ id: "audit-1" })),
  } as unknown as AuditService;
  const config = {
    configEncryptionKey: key,
    configEncryptionKeys: undefined,
  } as AppConfigService;

  return {
    audit,
    config,
    history,
    providers,
    secrets,
    service: new ProviderSecretService(prisma, audit, config),
  };
}

describe("ProviderSecretService", () => {
  it("encrypts a replacement, masks it in state, and resolves it for runtime", async () => {
    const ctx = harness();

    const state = await ctx.service.replace({
      providerId: "provider-1",
      field: "apiKey",
      value: "sk-live-secret",
      expectedVersion: 3,
      actor: {
        user: { id: "0199a0c1-1100-7000-8000-000000000001" },
        ip: "203.0.113.10",
        userAgent: "vitest",
      } as never,
    });

    expect(state).toEqual({
      field: "apiKey",
      hasValue: true,
      last4: "cret",
      version: 1,
    });
    expect(JSON.stringify(state)).not.toContain("sk-live-secret");
    expect(await ctx.service.resolvePlaintext("provider-1")).toEqual({
      apiKey: "sk-live-secret",
    });
    expect(ctx.providers.get("provider-1")?.version).toBe(4);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.provider.secret_replaced",
        targetType: "provider",
        targetId: "provider-1",
        metadata: { field: "apiKey", last4: "cret", version: 1 },
      }),
      expect.anything(),
    );
  });

  it("binds a stored secret to the provider and field through AAD", async () => {
    const ctx = harness();
    await ctx.service.replace({
      providerId: "provider-1",
      field: "apiKey",
      value: "provider-one-key",
      expectedVersion: 3,
      actor: { user: { id: "0199a0c1-1100-7000-8000-000000000001" } } as never,
    });

    const stored = ctx.secrets.get("provider-1:apiKey");
    expect(stored).toBeTruthy();
    ctx.secrets.set("provider-2:apiKey", {
      ...(stored as SecretRow),
      id: "secret-copied",
      providerId: "provider-2",
    });

    await expect(ctx.service.resolvePlaintext("provider-2")).rejects.toMatchObject({
      status: 503,
      response: { code: "PROVIDER_SECRETS_UNAVAILABLE" },
    });
  });

  it("rejects a stale provider version without writing", async () => {
    const ctx = harness();

    await expect(
      ctx.service.replace({
        providerId: "provider-1",
        field: "apiKey",
        value: "new-key",
        expectedVersion: 2,
        actor: { user: { id: "0199a0c1-1100-7000-8000-000000000001" } } as never,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.secrets.size).toBe(0);
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  it("moves the previous ciphertext into a 24-hour history row and cleans it up", async () => {
    const ctx = harness();
    const actor = {
      user: { id: "0199a0c1-1100-7000-8000-000000000001" },
    } as never;

    await ctx.service.replace({
      providerId: "provider-1",
      field: "apiKey",
      value: "first-key",
      expectedVersion: 3,
      actor,
    });
    const firstCiphertext = ctx.secrets.get("provider-1:apiKey")?.ciphertext;
    expect(firstCiphertext).toBeTruthy();

    await ctx.service.replace({
      providerId: "provider-1",
      field: "apiKey",
      value: "second-key",
      expectedVersion: 4,
      actor,
    });

    expect(ctx.history).toHaveLength(1);
    expect(ctx.history[0]?.ciphertext).toBe(firstCiphertext);
    expect(ctx.history[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1_000);
    expect(ctx.secrets.get("provider-1:apiKey")?.version).toBe(2);
    expect(await ctx.service.resolvePlaintext("provider-1")).toEqual({ apiKey: "second-key" });

    const deleted = await ctx.service.cleanupExpired(new Date(Date.now() + 25 * 60 * 60 * 1_000));
    expect(deleted).toBe(1);
    expect(ctx.history).toHaveLength(0);
  });

  it("fails closed when the keyring is missing while list metadata remains readable", async () => {
    const ctx = harness();
    const box = SecretBox.fromEnvironment({
      CONFIG_ENCRYPTION_KEY: ctx.config.configEncryptionKey,
    });
    const encrypted = box.encrypt("provider:provider-1:apiKey", "stored-key");
    ctx.secrets.set("provider-1:apiKey", {
      id: "secret-existing",
      providerId: "provider-1",
      field: "apiKey",
      ciphertext: encrypted.ciphertext,
      last4: "-key",
      keyVersion: encrypted.keyVersion,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const noKeyConfig = {
      configEncryptionKey: undefined,
      configEncryptionKeys: undefined,
    } as AppConfigService;
    const service = new ProviderSecretService(
      {
        client: {
          providerConnection: { findUnique: async () => providersLookup() },
          providerSecret: {
            findMany: async () => [...ctx.secrets.values()],
          },
        },
      } as never,
      ctx.audit,
      noKeyConfig,
    );

    expect(await service.listStates("provider-1")).toEqual([
      { field: "apiKey", hasValue: true, last4: "-key", version: 1 },
    ]);
    await expect(service.resolvePlaintext("provider-1")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("never exposes ciphertext or plaintext from listStates", async () => {
    const ctx = harness();
    await ctx.service.replace({
      providerId: "provider-1",
      field: "apiKey",
      value: "sensitive-value",
      expectedVersion: 3,
      actor: { user: { id: "0199a0c1-1100-7000-8000-000000000001" } } as never,
    });

    const states = await ctx.service.listStates("provider-1");
    expect(states).toEqual([{ field: "apiKey", hasValue: true, last4: "alue", version: 1 }]);
    expect(JSON.stringify(states)).not.toContain("sensitive-value");
    expect(JSON.stringify(states)).not.toContain(ctx.secrets.get("provider-1:apiKey")?.ciphertext);
  });
});

function providersLookup() {
  return { id: "provider-1", version: 3, deletedAt: null };
}
