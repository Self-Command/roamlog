import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-PostgreSQL proof for the two map-provider contract fixes:
 * 1. Tencent/map-pin destinations satisfy the stored CHECK;
 * 2. the data migration raises only active Geoapify timeouts below 5 s.
 *
 * Each assertion uses a throwaway schema so a developer database is untouched.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED map provider contract integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

function connectionWithoutSchema(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

function schemaFromUrl(databaseUrl: string): string {
  const raw = new URL(databaseUrl).searchParams.get("schema")?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/u.test(raw)) {
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

const USER_ID = "0199f070-0000-7000-8000-000000000301";
const WORKSPACE_ID = "0199f070-0000-7000-8000-000000000302";
const MEMBER_ID = "0199f070-0000-7000-8000-000000000303";
const TRIP_ID = "0199f070-0000-7000-8000-000000000304";
const DESTINATION_TENCENT = "0199f070-0000-7000-8000-000000000305";
const DESTINATION_MAP_PIN = "0199f070-0000-7000-8000-000000000306";

async function insertTrip(client: Client): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "updatedAt")
       VALUES ($1, 'map-contract@roamlog.test', 'Map Contract', now())`,
      [USER_ID],
    );
    await client.query(
      `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
       VALUES ($1, 'Map Contract', 'map-contract', $2, now())`,
      [WORKSPACE_ID, USER_ID],
    );
    await client.query(
      `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'owner', now())`,
      [MEMBER_ID, WORKSPACE_ID, USER_ID],
    );
    await client.query(
      `INSERT INTO "Trip" ("id", "workspaceId", "title", "startDate", "endDate", "origin",
         "destinations", "createdById", "updatedById", "updatedAt")
       VALUES ($1, $2, 'Provider contract', DATE '2027-02-01', DATE '2027-02-03', 'Shanghai',
         ARRAY[]::text[], $3, $3, now())`,
      [TRIP_ID, WORKSPACE_ID, USER_ID],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

integration("map provider contract against PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const baseSchema = schemaFromUrl(testDatabaseUrl);
  const contractSchema = `${baseSchema}_map_contract`;
  const timeoutSchema = `${baseSchema}_map_timeout`;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl) });
    await admin.connect();
    for (const schema of [contractSchema, timeoutSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${schema}"`);
    }
  });

  afterAll(async () => {
    for (const schema of [contractSchema, timeoutSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.end();
  });

  it("persists Tencent and map-pin destination providers and rejects unknown ones", async () => {
    await applyMigrations(admin, contractSchema, migrations);
    await admin.query(`SET search_path TO "${contractSchema}"`);
    await insertTrip(admin);

    await admin.query(
      `INSERT INTO "TripDestination" ("id", "tripId", "name", "provider", "order")
       VALUES
         ($1, $3, '北京市', 'tencent', 0),
         ($2, $3, '地图选点', 'map_pin', 1)`,
      [DESTINATION_TENCENT, DESTINATION_MAP_PIN, TRIP_ID],
    );

    const rows = await admin.query<{ provider: string }>(
      `SELECT "provider" FROM "TripDestination" WHERE "tripId" = $1 ORDER BY "order"`,
      [TRIP_ID],
    );
    expect(rows.rows.map((row) => row.provider)).toEqual(["tencent", "map_pin"]);

    await admin.query("BEGIN");
    let violation: { code?: string; constraint?: string } | undefined;
    try {
      await admin.query(
        `INSERT INTO "TripDestination" ("id", "tripId", "name", "provider", "order")
         VALUES ('0199f070-0000-7000-8000-000000000307', $1, 'Invalid', 'invalid', 2)`,
        [TRIP_ID],
      );
    } catch (error) {
      violation = error as { code?: string; constraint?: string };
    } finally {
      await admin.query("ROLLBACK");
    }
    expect(violation?.code).toBe("23514");
    expect(violation?.constraint).toBe("TripDestination_provider_check");
  });

  it("raises only active Geoapify timeouts below five seconds", async () => {
    await applyMigrations(
      admin,
      timeoutSchema,
      migrations.filter((name) => name < "0031"),
    );
    await admin.query(`SET search_path TO "${timeoutSchema}"`);
    await admin.query(
      `INSERT INTO "ProviderConnection"
        ("id", "group", "adapter", "label", "config", "version", "healthStatus", "updatedAt", "deletedAt")
       VALUES
        ('0199f070-0000-7000-8000-000000000311', 'places', 'geoapify', 'Low',
          '{"baseUrl":"https://geoapify.example.test","timeoutMs":2000}'::jsonb, 1, 'healthy', now(), NULL),
        ('0199f070-0000-7000-8000-000000000312', 'places', 'geoapify', 'Custom',
          '{"baseUrl":"https://geoapify.example.test","timeoutMs":7000}'::jsonb, 1, 'healthy', now(), NULL),
        ('0199f070-0000-7000-8000-000000000313', 'places', 'geoapify', 'Deleted',
          '{"baseUrl":"https://geoapify.example.test","timeoutMs":2000}'::jsonb, 1, 'healthy', now(), now()),
        ('0199f070-0000-7000-8000-000000000314', 'places', 'geoapify', 'Malformed',
          '{"baseUrl":"https://geoapify.example.test","timeoutMs":"fast"}'::jsonb, 1, 'healthy', now(), NULL)`,
    );

    await applyMigrations(admin, timeoutSchema, ["0031_geoapify_timeout_floor"]);

    const rows = await admin.query<{
      id: string;
      config: { timeoutMs: number | string };
      version: number;
      healthStatus: string;
    }>(`SELECT "id", "config", "version", "healthStatus" FROM "ProviderConnection" ORDER BY "id"`);

    expect(rows.rows).toEqual([
      {
        id: "0199f070-0000-7000-8000-000000000311",
        config: expect.objectContaining({ timeoutMs: 5000 }),
        version: 2,
        healthStatus: "unknown",
      },
      {
        id: "0199f070-0000-7000-8000-000000000312",
        config: expect.objectContaining({ timeoutMs: 7000 }),
        version: 1,
        healthStatus: "healthy",
      },
      {
        id: "0199f070-0000-7000-8000-000000000313",
        config: expect.objectContaining({ timeoutMs: 2000 }),
        version: 1,
        healthStatus: "healthy",
      },
      {
        id: "0199f070-0000-7000-8000-000000000314",
        config: expect.objectContaining({ timeoutMs: "fast" }),
        version: 1,
        healthStatus: "healthy",
      },
    ]);
  });
});
