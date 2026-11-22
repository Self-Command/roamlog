import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient } from "../client.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED PlatformRoleOverride integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
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

function scopedUrl(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function migrationSql(migration: string): string {
  return readFileSync(new URL(`${migration}/migration.sql`, migrationsDir), "utf8");
}

const PROBE_USER_ID = "00000000-0000-7000-8000-00000000c501";

integration("PlatformRoleOverride migration against PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  // Own private schemas so the seed and settings integration tests can run in
  // parallel without sharing DDL state.
  const emptySchema = `${baseSchema}_perm_empty`;
  const upgradeSchema = `${baseSchema}_perm_upgrade`;
  let admin: Client;
  let emptyPrisma: ReturnType<typeof createPrismaClient>;
  let upgradePrisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl ?? "") });
    await admin.connect();

    for (const schema of [emptySchema, upgradeSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${schema}"`);
    }

    // Empty database: every migration runs from scratch, exactly like a fresh
    // deployment.
    await admin.query(`SET search_path TO "${emptySchema}"`);
    for (const migration of migrations) {
      await admin.query(migrationSql(migration));
    }

    // Existing database: 0001–0004 already ran and hold real rows. 0005 must be
    // additive and leave those rows untouched.
    await admin.query(`SET search_path TO "${upgradeSchema}"`);
    for (const migration of migrations) {
      if (migration === "0005_platform_role_override") {
        await admin.query(
          `INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, $2, $3, now())`,
          [PROBE_USER_ID, "b3-override-probe@roamlog.test", "B3 Override Probe"],
        );
        expect(
          await admin.query(`SELECT count(*)::int AS count FROM "User" WHERE "id" = $1`, [
            PROBE_USER_ID,
          ]),
        ).toMatchObject({ rows: [{ count: 1 }] });
      }
      await admin.query(migrationSql(migration));
    }

    emptyPrisma = createPrismaClient({ connectionString: scopedUrl(testDatabaseUrl ?? "", emptySchema) });
    upgradePrisma = createPrismaClient({ connectionString: scopedUrl(testDatabaseUrl ?? "", upgradeSchema) });
    await emptyPrisma.$connect();
    await upgradePrisma.$connect();
  });

  afterAll(async () => {
    await emptyPrisma?.$disconnect();
    await upgradePrisma?.$disconnect();
    if (admin) {
      for (const schema of [emptySchema, upgradeSchema]) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      }
      await admin.end();
    }
  });

  it("creates the table and index in an empty database", async () => {
    const table = await admin.query(
      `SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'PlatformRoleOverride' AND table_schema = $1`,
      [emptySchema],
    );
    expect(table.rows).toEqual([{ table_schema: emptySchema }]);

    const index = await admin.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1
        AND indexname = 'PlatformRoleOverride_updatedById_idx'`,
      [emptySchema],
    );
    expect(index.rows).toEqual([{ indexname: "PlatformRoleOverride_updatedById_idx" }]);

    expect(await emptyPrisma.platformRoleOverride.count()).toBe(0);
  });

  it("preserves rows that existed before 0005 ran", async () => {
    expect(await upgradePrisma.user.count({ where: { id: PROBE_USER_ID } })).toBe(1);
  });

  it("stores only the diff as a role+action row and can delete it again", async () => {
    const created = await upgradePrisma.platformRoleOverride.create({
      data: {
        role: "support",
        action: "admin:flags:update",
        granted: true,
      },
    });
    expect(created).toMatchObject({
      role: "support",
      action: "admin:flags:update",
      granted: true,
    });

    await upgradePrisma.platformRoleOverride.upsert({
      where: { role_action: { role: "support", action: "admin:flags:update" } },
      create: { role: "support", action: "admin:flags:update", granted: false },
      update: { granted: false, updatedById: PROBE_USER_ID },
    });
    expect(
      await upgradePrisma.platformRoleOverride.findUnique({
        where: { role_action: { role: "support", action: "admin:flags:update" } },
      }),
    ).toMatchObject({ granted: false, updatedById: PROBE_USER_ID });

    await upgradePrisma.platformRoleOverride.delete({
      where: { role_action: { role: "support", action: "admin:flags:update" } },
    });
    expect(await upgradePrisma.platformRoleOverride.count()).toBe(0);
  });
});
