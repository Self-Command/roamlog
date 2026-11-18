import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();

const migrationName = "0003_w0_trip_stop_place_metadata";
const migrationSqlPath = path.join(
  migrationsDir,
  migrationName,
  "migration.sql",
);
const schemaPath = fileURLToPath(
  new URL("../../prisma/schema.prisma", import.meta.url),
);

const schema = readFileSync(schemaPath, "utf8");
const rawSql = readFileSync(migrationSqlPath, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function modelBody(model: string): string {
  const match = schema.match(
    new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match?.[1]) {
    throw new Error(`Missing model ${model}`);
  }
  return match[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface AddedColumn {
  model: "Trip" | "Stop";
  column: string;
  prismaType: string;
  prismaAttribute?: string;
  postgresType: string;
}

/**
 * Single source of truth for the Wave 0 place/budget slice: every column is
 * nullable, has no default, and must exist with the same type in both the
 * Prisma model and the migration.
 */
const addedColumns: AddedColumn[] = [
  {
    model: "Trip",
    column: "originLat",
    prismaType: "Float?",
    postgresType: "DOUBLE PRECISION",
  },
  {
    model: "Trip",
    column: "originLng",
    prismaType: "Float?",
    postgresType: "DOUBLE PRECISION",
  },
  {
    model: "Trip",
    column: "originCountryCode",
    prismaType: "String?",
    prismaAttribute: "@db.Char(2)",
    postgresType: "CHAR(2)",
  },
  {
    model: "Trip",
    column: "timeZone",
    prismaType: "String?",
    postgresType: "TEXT",
  },
  {
    model: "Stop",
    column: "provider",
    prismaType: "String?",
    postgresType: "TEXT",
  },
  {
    model: "Stop",
    column: "providerPlaceId",
    prismaType: "String?",
    postgresType: "TEXT",
  },
  {
    model: "Stop",
    column: "timeZone",
    prismaType: "String?",
    postgresType: "TEXT",
  },
];

describe("0003_w0_trip_stop_place_metadata migration", () => {
  it("is ordered after the existing migrations", () => {
    expect(migrations).toContain("0002_two_factor_state");
    const index = migrations.indexOf(migrationName);
    expect(index, `${migrationName} must exist`).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      migrations.indexOf("0002_two_factor_state"),
    );
  });

  it("keeps the Prisma model and the SQL column set identical", () => {
    for (const column of addedColumns) {
      const body = modelBody(column.model);
      const prismaLine = new RegExp(
        `\\n\\s+${column.column}\\s+${escapeRegExp(column.prismaType)}` +
          (column.prismaAttribute
            ? `\\s+${escapeRegExp(column.prismaAttribute)}`
            : ""),
      );
      expect(body, `${column.model}.${column.column} in schema.prisma`).toMatch(
        prismaLine,
      );
      expect(
        sql,
        `${column.model}.${column.column} in migration.sql`,
      ).toContain(
        `ADD COLUMN "${column.column}" ${column.postgresType}`,
      );
      expect(
        sql,
        `${column.model}.${column.column} must not be NOT NULL`,
      ).not.toMatch(
        new RegExp(
          `ADD COLUMN "${column.column}"\\s+[A-Z()0-9 ]+NOT NULL`,
        ),
      );
      expect(
        sql,
        `${column.model}.${column.column} must not have a default`,
      ).not.toMatch(
        new RegExp(`ADD COLUMN "${column.column}"[^,]*DEFAULT`),
      );
    }
  });

  it("only adds nullable columns and never rewrites data or existing columns", () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).not.toMatch(/SET NOT NULL/i);
    expect(sql).not.toMatch(/\bNOT NULL\b/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(sql).not.toMatch(/PRIMARY KEY/i);
  });

  it("enforces the origin coordinate pair and range", () => {
    expect(sql).toContain(
      'ADD CONSTRAINT "Trip_origin_coords_pair_check" CHECK (("originLat" IS NULL) = ("originLng" IS NULL))',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "Trip_origin_lat_range_check" CHECK ("originLat" IS NULL OR "originLat" BETWEEN -90 AND 90)',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "Trip_origin_lng_range_check" CHECK ("originLng" IS NULL OR "originLng" BETWEEN -180 AND 180)',
    );
  });

  it("enforces the budget nonnegative and pair invariants", () => {
    expect(sql).toContain(
      'ADD CONSTRAINT "Trip_budget_amount_nonnegative_check" CHECK ("budgetAmountMinor" IS NULL OR "budgetAmountMinor" >= 0)',
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "Trip_budget_pair_check" CHECK (("budgetAmountMinor" IS NULL) = ("budgetCurrency" IS NULL))',
    );
  });

  it("enforces the Stop provider allow-list", () => {
    expect(sql).toContain(
      'ADD CONSTRAINT "Stop_provider_check" CHECK ("provider" IS NULL OR "provider" IN (\'photon\', \'local\'))',
    );
  });
});

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0003 migration integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise the CHECK constraints " +
      "against a real PostgreSQL database.\n",
  );
}

// pg does not understand Prisma's ?schema= query parameter.
function pgConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

const USER_ID = "00000000-0000-7000-8000-000000000001";
const WORKSPACE_ID = "00000000-0000-7000-8000-000000000002";
const TRIP_ID = "00000000-0000-7000-8000-000000000003";
const STOP_ID = "00000000-0000-7000-8000-000000000004";

async function insertFixtures(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO "User" ("id", "email", "name", "updatedAt")
     VALUES ($1, 'w0-db-constraint@roamlog.test', 'W0 DB', now())`,
    [USER_ID],
  );
  await client.query(
    `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
     VALUES ($1, 'W0 DB', 'w0-db-constraint', $2, now())`,
    [WORKSPACE_ID, USER_ID],
  );
  await client.query(
    `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
     VALUES ('00000000-0000-7000-8000-000000000005', $1, $2, 'owner', now())`,
    [WORKSPACE_ID, USER_ID],
  );
  await client.query(
    `INSERT INTO "Trip" (
       "id", "workspaceId", "title", "startDate", "endDate", "origin",
       "createdById", "updatedById", "updatedAt"
     ) VALUES (
       $1, $2, 'W0 DB trip', DATE '2026-12-01', DATE '2026-12-05', 'Shanghai',
       $3, $3, now()
     )`,
    [TRIP_ID, WORKSPACE_ID, USER_ID],
  );
  await client.query(
    `INSERT INTO "Stop" (
       "id", "tripId", "workspaceId", "city", "country", "countryCode",
       "startDate", "endDate", "notes", "createdById", "updatedById", "updatedAt"
     ) VALUES (
       $1, $2, $3, 'Paris', 'France', 'FR',
       DATE '2026-12-01', DATE '2026-12-02', '', $4, $4, now()
     )`,
    [STOP_ID, TRIP_ID, WORKSPACE_ID, USER_ID],
  );
}

/**
 * Runs `fn` inside a transaction that is always rolled back. The workspace
 * owner constraint triggers are DEFERRABLE INITIALLY DEFERRED, so they never
 * fire and no fixture rows survive the test.
 */
async function inRolledBackTransaction(
  client: Client,
  fn: () => Promise<void>,
): Promise<void> {
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
    await insertFixtures(client);
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

integration("0003 CHECK constraints against PostgreSQL", () => {
  // Created in beforeAll so `describe.skip` never parses an empty URL.
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      connectionString: pgConnectionString(testDatabaseUrl ?? ""),
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("rejects a half origin coordinate pair", async () => {
    await expectCheckViolation(
      client,
      () =>
        client.query(`UPDATE "Trip" SET "originLat" = 48.8566 WHERE "id" = $1`, [
          TRIP_ID,
        ]),
      "Trip_origin_coords_pair_check",
    );
    await expectCheckViolation(
      client,
      () =>
        client.query(`UPDATE "Trip" SET "originLng" = 2.3522 WHERE "id" = $1`, [
          TRIP_ID,
        ]),
      "Trip_origin_coords_pair_check",
    );
  });

  it("rejects out-of-range origin coordinates", async () => {
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip" SET "originLat" = 90.5, "originLng" = 0 WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_origin_lat_range_check",
    );
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip" SET "originLat" = -90.5, "originLng" = 0 WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_origin_lat_range_check",
    );
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip" SET "originLat" = 0, "originLng" = 180.5 WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_origin_lng_range_check",
    );
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip" SET "originLat" = 0, "originLng" = -180.5 WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_origin_lng_range_check",
    );
  });

  it("rejects a negative budget and a one-sided budget pair", async () => {
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip"
             SET "budgetAmountMinor" = -1, "budgetCurrency" = 'CNY'
           WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_budget_amount_nonnegative_check",
    );
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip" SET "budgetAmountMinor" = 120000 WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_budget_pair_check",
    );
    await expectCheckViolation(
      client,
      () =>
        client.query(
          `UPDATE "Trip" SET "budgetCurrency" = 'CNY' WHERE "id" = $1`,
          [TRIP_ID],
        ),
      "Trip_budget_pair_check",
    );
  });

  it("rejects an unknown Stop provider", async () => {
    await expectCheckViolation(
      client,
      () =>
        client.query(`UPDATE "Stop" SET "provider" = 'mapbox' WHERE "id" = $1`, [
          STOP_ID,
        ]),
      "Stop_provider_check",
    );
  });

  it("accepts the boundary values, the provider allow-list and a NULL reset", async () => {
    await inRolledBackTransaction(client, async () => {
      await insertFixtures(client);

      await client.query(
        `UPDATE "Trip"
           SET "originLat" = -90, "originLng" = 180,
               "originCountryCode" = 'FR', "timeZone" = 'Europe/Paris',
               "budgetAmountMinor" = 0, "budgetCurrency" = 'CNY'
         WHERE "id" = $1`,
        [TRIP_ID],
      );
      const trip = await client.query<{
        originLat: number | null;
        originLng: number | null;
        originCountryCode: string | null;
        timeZone: string | null;
        budgetAmountMinor: number | null;
        budgetCurrency: string | null;
      }>(
        `SELECT "originLat", "originLng", "originCountryCode", "timeZone",
                "budgetAmountMinor", "budgetCurrency"
           FROM "Trip" WHERE "id" = $1`,
        [TRIP_ID],
      );
      expect(trip.rows[0]).toMatchObject({
        originLat: -90,
        originLng: 180,
        originCountryCode: "FR",
        timeZone: "Europe/Paris",
        budgetAmountMinor: 0,
        budgetCurrency: "CNY",
      });

      await client.query(
        `UPDATE "Trip"
           SET "originLat" = NULL, "originLng" = NULL,
               "originCountryCode" = NULL, "timeZone" = NULL,
               "budgetAmountMinor" = NULL, "budgetCurrency" = NULL
         WHERE "id" = $1`,
        [TRIP_ID],
      );
      const cleared = await client.query<{ originLat: number | null }>(
        `SELECT "originLat" FROM "Trip" WHERE "id" = $1`,
        [TRIP_ID],
      );
      expect(cleared.rows[0]?.originLat).toBeNull();

      for (const provider of ["photon", "local"]) {
        await client.query(
          `UPDATE "Stop"
             SET "provider" = $1, "providerPlaceId" = 'place-1',
                 "timeZone" = 'Europe/Paris'
           WHERE "id" = $2`,
          [provider, STOP_ID],
        );
      }
      const stop = await client.query<{
        provider: string | null;
        providerPlaceId: string | null;
        timeZone: string | null;
      }>(
        `SELECT "provider", "providerPlaceId", "timeZone" FROM "Stop" WHERE "id" = $1`,
        [STOP_ID],
      );
      expect(stop.rows[0]).toMatchObject({
        provider: "local",
        providerPlaceId: "place-1",
        timeZone: "Europe/Paris",
      });

      await client.query(`UPDATE "Stop" SET "provider" = NULL WHERE "id" = $1`, [
        STOP_ID,
      ]);
    });
  });
});
