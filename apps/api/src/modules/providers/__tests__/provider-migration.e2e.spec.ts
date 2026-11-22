/**
 * Real-PostgreSQL proof for `0016_provider_connections`.
 *
 * The test applies the complete migration chain to a disposable schema and
 * verifies that the five additive tables, their relations and the critical
 * database checks are present. It also proves that the provider rows can be
 * created without touching the scalar `SystemSetting` store.
 *
 * Skipped unless `ROAMLOG_TEST_DATABASE_URL` points at a disposable
 * PostgreSQL database.
 */

import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPrismaClient } from "@roamlog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0016 provider connections integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../");
const databaseRoot = resolve(repoRoot, "packages/db");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const prismaSchema = resolve(databaseRoot, "prisma/schema.prisma");
const schemaName = `provider_migration_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;

let adminClient: ReturnType<typeof createPrismaClient> | undefined;
let prisma: ReturnType<typeof createPrismaClient> | undefined;

function requiredPrisma(): ReturnType<typeof createPrismaClient> {
  if (!prisma) {
    throw new Error("Provider migration test database is not initialized.");
  }
  return prisma;
}

const PROVIDER_ROWS = [
  { group: "ai", adapter: "openai-chat", routingMode: "priority" },
  { group: "places", adapter: "tencent", routingMode: "merge" },
  { group: "mail", adapter: "resend", routingMode: "single" },
  { group: "storage", adapter: "s3", routingMode: "single" },
] as const;

integration("0016_provider_connections against PostgreSQL", () => {
  if (!testDatabaseUrl) return;

  beforeAll(async () => {
    if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(schemaName)) {
      throw new Error(`Refusing unsafe test schema name: ${schemaName}`);
    }
    if (!existsSync(prismaCli) || !existsSync(prismaSchema)) {
      throw new Error("The Prisma CLI or database schema path is unavailable.");
    }

    adminClient = createPrismaClient({ connectionString: testDatabaseUrl });
    await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminClient.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    const scoped = new URL(testDatabaseUrl);
    scoped.searchParams.set("schema", schemaName);
    scoped.searchParams.set("options", `-c search_path=${schemaName}`);
    const scopedUrl = scoped.toString();

    const migration = spawnSync(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", prismaSchema],
      {
        cwd: databaseRoot,
        env: { ...process.env, DATABASE_URL: scopedUrl },
        encoding: "utf8",
      },
    );
    if (migration.status !== 0) {
      const diagnostic = `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`.trim();
      throw new Error(
        `prisma migrate deploy failed (exit ${String(migration.status)}): ${diagnostic.slice(-2000)}`,
      );
    }

    prisma = createPrismaClient({ connectionString: scopedUrl });
    await prisma.$queryRaw`SELECT 1`;
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (adminClient) {
      try {
        await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } catch (error) {
        process.stderr.write(`WARN: could not drop ${schemaName}: ${String(error)}\n`);
      }
      await adminClient.$disconnect();
    }
  }, 60_000);

  it("creates every provider table and leaves the scalar settings store intact", async () => {
    const tables = await requiredPrisma().$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN (
            'ProviderGroupPolicy',
            'ProviderConnection',
            'ProviderSecret',
            'ProviderSecretHistory',
            'ProviderModel'
          )
        ORDER BY table_name`,
      schemaName,
    );

    expect(tables.map((row) => row.table_name)).toEqual([
      "ProviderConnection",
      "ProviderGroupPolicy",
      "ProviderModel",
      "ProviderSecret",
      "ProviderSecretHistory",
    ]);
    await expect(requiredPrisma().systemSetting.count()).resolves.toBe(0);
  });

  it("accepts one provider in each group and persists its secret/model relations", async () => {
    const client = requiredPrisma();
    const providers = [];
    for (const row of PROVIDER_ROWS) {
      const provider = await client.providerConnection.create({
        data: {
          group: row.group,
          adapter: row.adapter,
          label: `${row.group} provider`,
          config: {},
        },
      });
      providers.push(provider);
      await client.providerGroupPolicy.create({
        data: {
          group: row.group,
          routingMode: row.routingMode,
          maxAttempts: row.group === "ai" || row.group === "places" ? 3 : 1,
          cooldownSeconds: 30,
        },
      });
    }

    const aiProvider = providers[0];
    if (!aiProvider) throw new Error("AI provider fixture was not created.");

    await client.providerSecret.create({
      data: {
        providerId: aiProvider.id,
        field: "apiKey",
        ciphertext: "v1:test:redacted",
        last4: "4242",
        keyVersion: 1,
      },
    });
    await client.providerSecretHistory.create({
      data: {
        providerId: aiProvider.id,
        field: "apiKey",
        ciphertext: "v1:test:old",
        last4: "1111",
        keyVersion: 1,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await client.providerModel.create({
      data: {
        providerId: aiProvider.id,
        modelId: "test-model",
        displayName: "Test Model",
        discoveredAt: new Date(),
      },
    });

    await expect(client.providerConnection.count()).resolves.toBe(4);
    await expect(client.providerSecret.count()).resolves.toBe(1);
    await expect(client.providerSecretHistory.count()).resolves.toBe(1);
    await expect(client.providerModel.count()).resolves.toBe(1);
  });

  it("rejects invalid groups, priorities and routing policies at the database boundary", async () => {
    const client = requiredPrisma();

    await expect(
      client.$executeRawUnsafe(
        `INSERT INTO "ProviderConnection"
          ("id", "group", "adapter", "label", "config", "updatedAt")
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, now())`,
        randomUUID(),
        "llm",
        "openai-chat",
        "Invalid group",
        "{}",
      ),
    ).rejects.toThrow(/ProviderConnection_group_check/);

    await expect(
      client.$executeRawUnsafe(
        `INSERT INTO "ProviderConnection"
          ("id", "group", "adapter", "label", "priority", "config", "updatedAt")
         VALUES ($1::uuid, $2, $3, $4, -1, $5::jsonb, now())`,
        randomUUID(),
        "ai",
        "openai-chat",
        "Invalid priority",
        "{}",
      ),
    ).rejects.toThrow(/ProviderConnection_priority_check/);

    await expect(
      client.providerGroupPolicy.create({
        data: { group: "ai", routingMode: "merge", maxAttempts: 1, cooldownSeconds: 1 },
      }),
    ).rejects.toThrow(/ProviderGroupPolicy_routingMode_check/);
  });
});
