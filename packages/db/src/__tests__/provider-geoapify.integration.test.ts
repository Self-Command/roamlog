import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-PostgreSQL proof for `0007_stop_provider_geoapify`.
 *
 * 1. an empty database that receives every migration in order (0001–0007), and
 * 2. a database that already holds a pre-0007 stop, whose rows must be
 *    untouched while the widened allow-list starts accepting `geoapify`.
 *
 * Everything runs in throwaway schemas derived from the database name, so the
 * test never depends on, or mutates, the operator's working schema.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0007 provider integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
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

async function applyMigrations(admin: Client, schema: string, names: readonly string[]) {
  await admin.query(`SET search_path TO "${schema}"`);
  for (const name of names) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8");
    await admin.query(sql);
  }
}

const USER_ID = "0199f060-0000-7000-8000-000000000101";
const WORKSPACE_ID = "0199f060-0000-7000-8000-000000000102";
const TRIP_ID = "0199f060-0000-7000-8000-000000000103";
const LEGACY_STOP_ID = "0199f060-0000-7000-8000-000000000104";
const MEMBER_ID = "0199f060-0000-7000-8000-000000000105";
const GEOAPIFY_STOP_ID = "0199f060-0000-7000-8000-000000000106";
const REJECTED_STOP_ID = "0199f060-0000-7000-8000-000000000107";

const LEGACY_ADDRESS = "京都市, 京都府, 日本";
const LEGACY_BBOX = "[135.6, 34.85, 135.93, 35.17]";

/** Rows that exist *before* 0007 runs, at provider `'photon'`. */
async function insertLegacyRows(admin: Client): Promise<void> {
  // One transaction: the Workspace owner constraint is DEFERRABLE INITIALLY
  // DEFERRED, so it is only satisfied once the owner member lands in the same
  // transaction. Autocommit would fail on the Workspace insert alone.
  await admin.query("BEGIN");
  try {
    await admin.query(
      `INSERT INTO "User" ("id", "email", "name", "updatedAt") VALUES ($1, 'f7-legacy@roamlog.test', 'F7 Legacy', now())`,
      [USER_ID],
    );
    await admin.query(
      `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
       VALUES ($1, 'F7 Legacy', 'f7-legacy', $2, now())`,
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
       VALUES ($1, $2, 'Pre-0007 trip', DATE '2027-01-01', DATE '2027-01-05', 'Shanghai', $3, $3, now())`,
      [TRIP_ID, WORKSPACE_ID, USER_ID],
    );
    await admin.query(
      `INSERT INTO "Stop" ("id", "tripId", "workspaceId", "city", "country", "countryCode",
         "provider", "providerPlaceId", "timeZone", "address", "bbox",
         "startDate", "endDate", "notes", "createdById", "updatedById", "updatedAt")
       VALUES ($1, $2, $3, 'Kyoto', 'Japan', 'JP',
         'photon', 'N:1234', 'Asia/Tokyo', $4, $5::jsonb,
         DATE '2027-01-01', DATE '2027-01-02', '', $6, $6, now())`,
      [LEGACY_STOP_ID, TRIP_ID, WORKSPACE_ID, LEGACY_ADDRESS, LEGACY_BBOX, USER_ID],
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

integration("0007_stop_provider_geoapify against PostgreSQL", () => {
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  const emptySchema = `${baseSchema}_provider_empty`;
  const migrationSchema = `${baseSchema}_provider`;
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

    // The series really did run end to end, not just the last file.
    const count = await admin.query(`SELECT count(*)::int AS count FROM "${emptySchema}"."Stop"`);
    expect(count.rows).toEqual([{ count: 0 }]);

    const constraints = await admin.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'Stop_provider_check'
          AND conrelid = '"${emptySchema}"."Stop"'::regclass`,
    );
    expect(constraints.rows).toHaveLength(1);
    const definition = constraints.rows[0]?.definition ?? "";
    for (const provider of ["geoapify", "photon", "local"]) {
      expect(definition).toContain(`'${provider}'`);
    }
  });

  it("keeps pre-0007 rows unchanged and then accepts geoapify", async () => {
    const before = migrations.filter((name) => name < "0007");
    await applyMigrations(admin, migrationSchema, before);
    await insertLegacyRows(admin);
    await applyMigrations(admin, migrationSchema, ["0007_stop_provider_geoapify"]);
    await admin.query(`SET search_path TO "${migrationSchema}"`);

    // Existing rows are not rewritten by a constraint-only migration.
    const legacy = await admin.query(
      `SELECT "city", "provider", "providerPlaceId", "timeZone", "address", "bbox"
         FROM "Stop" WHERE "id" = $1`,
      [LEGACY_STOP_ID],
    );
    expect(legacy.rows).toEqual([
      {
        city: "Kyoto",
        provider: "photon",
        providerPlaceId: "N:1234",
        timeZone: "Asia/Tokyo",
        address: LEGACY_ADDRESS,
        bbox: [135.6, 34.85, 135.93, 35.17],
      },
    ]);

    // The old row can now be relabelled to the provider it actually came from.
    await admin.query(`UPDATE "Stop" SET "provider" = 'geoapify' WHERE "id" = $1`, [
      LEGACY_STOP_ID,
    ]);
    const relabelled = await admin.query(`SELECT "provider" FROM "Stop" WHERE "id" = $1`, [
      LEGACY_STOP_ID,
    ]);
    expect(relabelled.rows).toEqual([{ provider: "geoapify" }]);

    // A brand-new Geoapify stop (with the 0006 place metadata) is accepted.
    await admin.query(
      `INSERT INTO "Stop" ("id", "tripId", "workspaceId", "city", "country", "countryCode",
         "provider", "providerPlaceId", "timeZone", "address", "bbox",
         "startDate", "endDate", "notes", "createdById", "updatedById", "updatedAt")
       VALUES ($1, $2, $3, 'Osaka', 'Japan', 'JP',
         'geoapify', '51e1bdfea47461405994da8b683bb64140f00103f9', 'Asia/Tokyo',
         '大阪市, 大阪府, 日本', '[135.13, 34.53, 135.68, 34.87]'::jsonb,
         DATE '2027-01-02', DATE '2027-01-03', '', $4, $4, now())`,
      [GEOAPIFY_STOP_ID, TRIP_ID, WORKSPACE_ID, USER_ID],
    );
    const inserted = await admin.query(
      `SELECT "provider", "providerPlaceId", "address" FROM "Stop" WHERE "id" = $1`,
      [GEOAPIFY_STOP_ID],
    );
    expect(inserted.rows).toEqual([
      {
        provider: "geoapify",
        providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
        address: "大阪市, 大阪府, 日本",
      },
    ]);
  });

  it("still rejects an unknown provider with 23514 on update and insert", async () => {
    await admin.query(`SET search_path TO "${migrationSchema}"`);

    await expectCheckViolation(
      admin,
      () =>
        admin.query(`UPDATE "Stop" SET "provider" = 'unknown' WHERE "id" = $1`, [LEGACY_STOP_ID]),
      "Stop_provider_check",
    );

    await expectCheckViolation(
      admin,
      () =>
        admin.query(
          `INSERT INTO "Stop" ("id", "tripId", "workspaceId", "city", "country", "countryCode",
             "provider", "startDate", "endDate", "notes", "createdById", "updatedById", "updatedAt")
           VALUES ($1, $2, $3, 'Nara', 'Japan', 'JP',
             'unknown', DATE '2027-01-03', DATE '2027-01-04', '', $4, $4, now())`,
          [REJECTED_STOP_ID, TRIP_ID, WORKSPACE_ID, USER_ID],
        ),
      "Stop_provider_check",
    );
  });
});
