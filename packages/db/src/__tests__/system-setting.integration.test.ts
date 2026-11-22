import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../client.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED SystemSetting integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

/** `pg` rejects Prisma's `?schema=` parameter, so strip it for DDL sessions. */
function connectionWithoutSchema(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

function schemaFromUrl(databaseUrl: string): string {
  const raw = new URL(databaseUrl).searchParams.get("schema")?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(raw)) {
    throw new Error(`Refusing unsafe test schema name: ${raw}`);
  }
  return raw;
}

const PROBE_USER_ID = "00000000-0000-7000-8000-00000000b1a1";
const PROBE_FLAG_KEY = "b1a.migration-probe";

integration("SystemSetting migration against PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  // Own a private schema instead of mutating the shared test schema: the seed
  // integration test runs against ROAMLOG_TEST_DATABASE_URL at the same time.
  const schema = `${baseSchema}_settings`;
  const scopedUrl = (() => {
    const url = new URL(testDatabaseUrl ?? "");
    url.searchParams.set("schema", schema);
    return url.toString();
  })();
  let admin: Client;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl ?? "") });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);

    for (const migration of migrations) {
      const sql = readFileSync(new URL(`${migration}/migration.sql`, migrationsDir), "utf8");
      // Apply 0004 after legacy data exists, proving the migration is additive
      // against a database that already has rows.
      if (migration === "0004_system_setting") {
        await admin.query(
          `INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, $2, $3, now())`,
          [PROBE_USER_ID, "b1a-probe@roamlog.test", "B1A Probe"],
        );
        await admin.query(
          `INSERT INTO "FeatureFlag"
             ("key", "description", "enabled", "rolloutPercentage", "rules", "updatedById", "createdAt", "updatedAt")
           VALUES ($1, 'pre-0004 row', false, 0, '{}'::jsonb, $2, now(), now())`,
          [PROBE_FLAG_KEY, PROBE_USER_ID],
        );
        expect(
          await admin.query(`SELECT count(*)::int AS count FROM "FeatureFlag" WHERE "key" = $1`, [
            PROBE_FLAG_KEY,
          ]),
        ).toMatchObject({ rows: [{ count: 1 }] });
      }
      await admin.query(sql);
    }

    prisma = createPrismaClient({ connectionString: scopedUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await admin.end();
    }
  });

  it("created the table and index in the isolated schema", async () => {
    const table = await admin.query(
      `SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'SystemSetting' AND table_schema = $1`,
      [schema],
    );
    expect(table.rows).toEqual([{ table_schema: schema }]);

    const index = await admin.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'SystemSetting_group_idx'`,
      [schema],
    );
    expect(index.rows).toEqual([{ indexname: "SystemSetting_group_idx" }]);
  });

  it("preserved rows that existed before 0004 ran", async () => {
    const flags = await prisma.featureFlag.findMany({ where: { key: PROBE_FLAG_KEY } });
    expect(flags).toHaveLength(1);
    expect(await prisma.user.count({ where: { id: PROBE_USER_ID } })).toBe(1);
  });

  it("writes and reads a non-secret value with code defaults applied", async () => {
    const created = await prisma.systemSetting.create({
      data: {
        key: "site.title",
        group: "general",
        valueType: "string",
        value: "Roamlog integration",
      },
    });

    expect(created.keyVersion).toBe(1);
    expect(created.envLocked).toBe(false);
    expect(created.isPublic).toBe(false);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const read = await prisma.systemSetting.findUnique({ where: { key: "site.title" } });
    expect(read?.value).toBe("Roamlog integration");
    expect(read?.secretCipher).toBeNull();
  });

  it("stores a rotated secret ciphertext without exposing plaintext in value", async () => {
    await prisma.systemSetting.create({
      data: {
        key: "mail.resendApiKey",
        group: "mail",
        valueType: "secret",
        secretCipher: "v1:deadbeef:AAAA",
        secretLast4: "abcd",
        keyVersion: 2,
      },
    });
    const read = await prisma.systemSetting.findUnique({ where: { key: "mail.resendApiKey" } });
    expect(read?.value).toBeNull();
    expect(read?.secretCipher).toBe("v1:deadbeef:AAAA");
    expect(read?.secretLast4).toBe("abcd");
    expect(read?.keyVersion).toBe(2);
  });

  it("reflects an update on the next read and bumps the operator key version", async () => {
    await prisma.systemSetting.update({
      where: { key: "site.title" },
      data: {
        value: "Roamlog renamed",
        keyVersion: 2,
        updatedById: PROBE_USER_ID,
        envLocked: true,
        isPublic: true,
      },
    });

    const read = await prisma.systemSetting.findUnique({ where: { key: "site.title" } });
    expect(read?.value).toBe("Roamlog renamed");
    expect(read?.keyVersion).toBe(2);
    expect(read?.envLocked).toBe(true);
    expect(read?.isPublic).toBe(true);
    expect(read?.updatedById).toBe(PROBE_USER_ID);
  });

  it("rejects rows that the registry could never serve", async () => {
    await admin.query("BEGIN");
    await expect(
      admin.query(
        `INSERT INTO "SystemSetting" ("key", "group", "valueType", "value", "updatedAt")
         VALUES ('bad.type', 'general', 'date', '"x"'::jsonb, now())`,
      ),
    ).rejects.toMatchObject({ constraint: "SystemSetting_valueType_check" });
    await admin.query("ROLLBACK");

    await admin.query("BEGIN");
    await expect(
      admin.query(
        `INSERT INTO "SystemSetting" ("key", "group", "valueType", "value", "updatedAt")
         VALUES ('bad.secret', 'mail', 'secret', '"plain"'::jsonb, now())`,
      ),
    ).rejects.toMatchObject({ constraint: "SystemSetting_secret_shape_check" });
    await admin.query("ROLLBACK");
  });

  it("enforces one row per key", async () => {
    await expect(
      prisma.systemSetting.create({
        data: {
          key: "site.title",
          group: "general",
          valueType: "string",
          value: "duplicate",
        },
      }),
    ).rejects.toThrow();
  });
});
