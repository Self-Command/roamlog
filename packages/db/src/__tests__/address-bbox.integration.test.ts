import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, Prisma } from "../client.js";

/**
 * Real-PostgreSQL proof for `0006_trip_stop_address_bbox`.
 *
 * Two independent schemas are exercised:
 *
 * 1. an empty database that receives every migration in order, and
 * 2. a database that already holds pre-0006 rows, which must keep NULL in the
 *    new columns while the CHECK constraints reject malformed boxes.
 *
 * The happy path goes through Prisma (write -> read -> clear) because that is the
 * exact code path the API uses.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0006 address/bbox integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
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

async function applyMigrations(admin: Client, schema: string, names: readonly string[]) {
  await admin.query(`SET search_path TO "${schema}"`);
  for (const name of names) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8");
    await admin.query(sql);
  }
}

const USER_ID = "0199f060-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0199f060-0000-7000-8000-000000000002";
const LEGACY_TRIP_ID = "0199f060-0000-7000-8000-000000000003";
const LEGACY_STOP_ID = "0199f060-0000-7000-8000-000000000004";
const MEMBER_ID = "0199f060-0000-7000-8000-000000000005";

/** Rows that exist *before* 0006 runs, so they carry no address/bbox values. */
async function insertLegacyRows(admin: Client): Promise<void> {
  // One transaction: the Workspace owner constraint is DEFERRABLE INITIALLY
  // DEFERRED, so it is only satisfied once the owner member lands in the same
  // transaction. Autocommit would fail on the Workspace insert alone.
  await admin.query("BEGIN");
  try {
    await admin.query(
      `INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, 'f6-legacy@roamlog.test', 'F6 Legacy', now())`,
      [USER_ID],
    );
    await admin.query(
      `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
       VALUES ($1, 'F6 Legacy', 'f6-legacy', $2, now())`,
      [WORKSPACE_ID, USER_ID],
    );
    await admin.query(
      `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'owner', now())`,
      [MEMBER_ID, WORKSPACE_ID, USER_ID],
    );
    await admin.query(
      `INSERT INTO "Trip" ("id", "workspaceId", "title", "startDate", "endDate", "origin",
         "createdById", "updatedById", "updatedAt")
       VALUES ($1, $2, 'Pre-0006 trip', DATE '2027-01-01', DATE '2027-01-05', 'Shanghai', $3, $3, now())`,
      [LEGACY_TRIP_ID, WORKSPACE_ID, USER_ID],
    );
    await admin.query(
      `INSERT INTO "Stop" ("id", "tripId", "workspaceId", "city", "country", "countryCode",
         "startDate", "endDate", "notes", "createdById", "updatedById", "updatedAt")
       VALUES ($1, $2, $3, 'Kyoto', 'Japan', 'JP', DATE '2027-01-01', DATE '2027-01-02', '', $4, $4, now())`,
      [LEGACY_STOP_ID, LEGACY_TRIP_ID, WORKSPACE_ID, USER_ID],
    );
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

async function inRolledBackTransaction(client: Client, fn: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function expectCheckViolation(
  client: Client,
  run: () => Promise<unknown>,
  constraint: string,
): Promise<void> {
  await inRolledBackTransaction(client, async () => {
    let error: { code?: string; constraint?: string } | undefined;
    try {
      await run();
    } catch (caught) {
      error = caught as { code?: string; constraint?: string };
    }
    expect(error, `${constraint} should reject the write`).toBeDefined();
    expect(error?.code).toBe("23514");
    expect(error?.constraint).toBe(constraint);
  });
}

integration("0006_trip_stop_address_bbox against PostgreSQL", () => {
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  const emptySchema = `${baseSchema}_f6empty`;
  const migrationSchema = `${baseSchema}_f6`;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl ?? "") });
    await admin.connect();
    for (const schema of [emptySchema, migrationSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${schema}"`);
    }
  });

  afterAll(async () => {
    for (const schema of [emptySchema, migrationSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.end();
  });

  it("applies the whole migration series to an empty database", async () => {
    await applyMigrations(admin, emptySchema, migrations);

    const columns = await admin.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND ((table_name = 'Trip' AND column_name IN ('originAddress', 'originBbox'))
            OR (table_name = 'Stop' AND column_name IN ('address', 'bbox')))
        ORDER BY table_name, column_name`,
      [emptySchema],
    );
    expect(columns.rows).toEqual([
      {
        table_name: "Stop",
        column_name: "address",
        data_type: "character varying",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "Stop",
        column_name: "bbox",
        data_type: "jsonb",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "Trip",
        column_name: "originAddress",
        data_type: "character varying",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "Trip",
        column_name: "originBbox",
        data_type: "jsonb",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
    // The series really did run end to end, not just the last file.
    expect(await admin.query(`SELECT count(*)::int AS count FROM "${emptySchema}"."Stop"`)).toMatchObject({
      rows: [{ count: 0 }],
    });
  });

  it("keeps rows created before 0006 and leaves the new columns NULL", async () => {
    const before = migrations.filter((name) => name < "0006");
    await applyMigrations(admin, migrationSchema, before);
    await insertLegacyRows(admin);
    await applyMigrations(admin, migrationSchema, ["0006_trip_stop_address_bbox"]);
    // Prisma's generated client knows every column, so bring the schema to
    // HEAD before reading the legacy row through it.
    await applyMigrations(admin, migrationSchema, ["0008_report_moderation"]);

    const trip = await admin.query(
      `SELECT "origin", "originAddress", "originBbox" FROM "${migrationSchema}"."Trip" WHERE "id" = $1`,
      [LEGACY_TRIP_ID],
    );
    expect(trip.rows).toEqual([{ origin: "Shanghai", originAddress: null, originBbox: null }]);

    const stop = await admin.query(
      `SELECT "city", "address", "bbox" FROM "${migrationSchema}"."Stop" WHERE "id" = $1`,
      [LEGACY_STOP_ID],
    );
    expect(stop.rows).toEqual([{ city: "Kyoto", address: null, bbox: null }]);
  });

  it("rejects malformed bbox values with the shape CHECK constraints", async () => {
    await admin.query(`SET search_path TO "${migrationSchema}"`);

    // An object (not an array) also proves `jsonb_array_length` is never reached
    // unguarded: a 22P02-style error here would not be a CHECK violation (23514).
    await expectCheckViolation(
      admin,
      () => admin.query(`UPDATE "Stop" SET "bbox" = '{"west": 1}'::jsonb WHERE "id" = $1`, [LEGACY_STOP_ID]),
      "Stop_bbox_shape_check",
    );
    for (const sqlValue of ['[1, 2, 3]', '[1, 2, 3, 4, 5]', '[1, 2, 3, "north"]']) {
      await expectCheckViolation(
        admin,
        () =>
          admin.query(`UPDATE "Stop" SET "bbox" = $1::jsonb WHERE "id" = $2`, [
            sqlValue,
            LEGACY_STOP_ID,
          ]),
        "Stop_bbox_shape_check",
      );
    }
    await expectCheckViolation(
      admin,
      () =>
        admin.query(`UPDATE "Trip" SET "originBbox" = '[1, 2, 3]'::jsonb WHERE "id" = $1`, [
          LEGACY_TRIP_ID,
        ]),
      "Trip_origin_bbox_shape_check",
    );
  });

  it("accepts a four-number bbox and writes/reads it through Prisma", async () => {
    const prisma = createPrismaClient({ connectionString: scopedUrl(testDatabaseUrl ?? "", migrationSchema) });
    try {
      const created = await prisma.trip.create({
        data: {
          id: "0199f060-0000-7000-8000-000000000010",
          workspaceId: WORKSPACE_ID,
          title: "Kyoto by rail",
          startDate: new Date("2027-03-01T00:00:00.000Z"),
          endDate: new Date("2027-03-06T00:00:00.000Z"),
          origin: "京都",
          originLat: 35.0116,
          originLng: 135.7681,
          originCountryCode: "JP",
          originAddress: "京都市, 京都府, 日本",
          originBbox: [135.6, 34.85, 135.93, 35.17],
          timeZone: "Asia/Tokyo",
          destinations: ["大阪"],
          countryCodes: ["JP"],
          createdById: USER_ID,
          updatedById: USER_ID,
        },
      });
      expect(created.originAddress).toBe("京都市, 京都府, 日本");
      expect(created.originBbox).toEqual([135.6, 34.85, 135.93, 35.17]);

      const stop = await prisma.stop.create({
        data: {
          id: "0199f060-0000-7000-8000-000000000011",
          tripId: created.id,
          workspaceId: WORKSPACE_ID,
          city: "京都",
          country: "日本",
          countryCode: "JP",
          lat: 35.0116,
          lng: 135.7681,
          provider: "photon",
          providerPlaceId: "N:1234",
          timeZone: "Asia/Tokyo",
          address: "京都市, 京都府, 日本",
          bbox: [135.6, 34.85, 135.93, 35.17],
          startDate: new Date("2027-03-01T00:00:00.000Z"),
          endDate: new Date("2027-03-02T00:00:00.000Z"),
          notes: "",
          createdById: USER_ID,
          updatedById: USER_ID,
        },
      });
      expect(stop.address).toBe("京都市, 京都府, 日本");
      expect(stop.bbox).toEqual([135.6, 34.85, 135.93, 35.17]);

      // The read path is what a page refresh does; it must not depend on cache.
      const reread = await prisma.trip.findUniqueOrThrow({ where: { id: created.id } });
      expect(reread.originAddress).toBe("京都市, 京都府, 日本");
      expect(reread.originBbox).toEqual([135.6, 34.85, 135.93, 35.17]);

      // `null` clears the column: Prisma needs DbNull for a Json column.
      const cleared = await prisma.trip.update({
        where: { id: created.id },
        data: { originAddress: null, originBbox: Prisma.DbNull },
      });
      expect(cleared.originAddress).toBeNull();
      expect(cleared.originBbox).toBeNull();

      const clearedStop = await prisma.stop.update({
        where: { id: stop.id },
        data: { address: null, bbox: Prisma.DbNull },
      });
      expect(clearedStop.address).toBeNull();
      expect(clearedStop.bbox).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});