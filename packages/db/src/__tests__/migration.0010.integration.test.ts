import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-PostgreSQL proof for `0010_trip_destinations`.
 *
 * 1. the whole migration series applies to an empty database;
 * 2. a populated pre-0010 database keeps its `Trip.destinations` values and gets
 *    one structured row per legacy name, in the original order;
 * 3. the new CHECKs reject out-of-contract rows;
 * 4. the partial unique index allows a soft-deleted position to be reused while
 *    still rejecting two *active* destinations at the same position.
 *
 * Every schema is throwaway (`<base>_dest_*`) so the operator's working schema
 * is never touched.
 */
const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0010 destinations integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
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

const USER_ID = "0199f070-0000-7000-8000-000000000101";
const WORKSPACE_ID = "0199f070-0000-7000-8000-000000000102";
const MEMBER_ID = "0199f070-0000-7000-8000-000000000103";
const TRIP_SINGLE = "0199f070-0000-7000-8000-000000000110";
const TRIP_TWO = "0199f070-0000-7000-8000-000000000111";
const TRIP_THREE = "0199f070-0000-7000-8000-000000000112";
const TRIP_EMPTY = "0199f070-0000-7000-8000-000000000113";

const LEGACY_TRIPS: Array<{ id: string; title: string; destinations: string[] }> = [
  { id: TRIP_SINGLE, title: "Tokyo", destinations: ["东京"] },
  { id: TRIP_TWO, title: "Kansai", destinations: ["京都", "大阪"] },
  { id: TRIP_THREE, title: "France", destinations: ["巴黎", "里昂", "尼斯"] },
  { id: TRIP_EMPTY, title: "Nowhere yet", destinations: [] },
];

async function insertLegacyRows(admin: Client): Promise<void> {
  await admin.query("BEGIN");
  try {
    await admin.query(
      `INSERT INTO "User" ("id", "email", "name", "updatedAt")
       VALUES ($1, 'dest-0010@roamlog.test', 'Dest 0010', now())`,
      [USER_ID],
    );
    await admin.query(
      `INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
       VALUES ($1, 'Dest 0010', 'dest-0010', $2, now())`,
      [WORKSPACE_ID, USER_ID],
    );
    await admin.query(
      `INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'owner', now())`,
      [MEMBER_ID, WORKSPACE_ID, USER_ID],
    );
    for (const trip of LEGACY_TRIPS) {
      await admin.query(
        `INSERT INTO "Trip" ("id", "workspaceId", "title", "startDate", "endDate", "origin",
           "destinations", "createdById", "updatedById", "updatedAt")
         VALUES ($1, $2, $3, DATE '2027-01-01', DATE '2027-01-05', 'Shanghai',
           $4::text[], $5, $5, now())`,
        [trip.id, WORKSPACE_ID, trip.title, trip.destinations, USER_ID],
      );
    }
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

async function expectViolation(
  client: Client,
  run: () => Promise<unknown>,
  code: string,
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
    expect(error?.code).toBe(code);
    expect(error?.constraint).toBe(constraint);
  });
}

function insertDestinationSql(columns: string, values: string): string {
  return `INSERT INTO "TripDestination" ("id", "tripId", ${columns}) VALUES ${values}`;
}

const DEST_ID = "0199f070-0000-7000-8000-000000000201";
const DEST_ID_2 = "0199f070-0000-7000-8000-000000000202";

integration("0010_trip_destinations against PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const baseSchema = schemaFromUrl(testDatabaseUrl ?? "");
  const emptySchema = `${baseSchema}_dest_empty`;
  const dataSchema = `${baseSchema}_dest_data`;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: connectionWithoutSchema(testDatabaseUrl ?? "") });
    await admin.connect();
    for (const schema of [emptySchema, dataSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${schema}"`);
    }
  });

  afterAll(async () => {
    for (const schema of [emptySchema, dataSchema]) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.end();
  });

  it("applies the whole migration series to an empty database", async () => {
    await applyMigrations(admin, emptySchema, migrations);

    const count = await admin.query(
      `SELECT count(*)::int AS count FROM "${emptySchema}"."TripDestination"`,
    );
    expect(count.rows).toEqual([{ count: 0 }]);

    // The full series really ran: the far end of the chain (0009) is present.
    const motion = await admin.query(
      `SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'MediaMotion' AND column_name = 'storageKey'`,
      [emptySchema],
    );
    expect(motion.rows).toEqual([{ count: 1 }]);
  });

  it("backfills every existing name with its order and keeps the deprecated column", async () => {
    await applyMigrations(
      admin,
      dataSchema,
      migrations.filter((name) => name < "0010"),
    );
    await insertLegacyRows(admin);
    await applyMigrations(admin, dataSchema, ["0010_trip_destinations"]);
    await admin.query(`SET search_path TO "${dataSchema}"`);

    const total = await admin.query(`SELECT count(*)::int AS count FROM "TripDestination"`);
    expect(total.rows).toEqual([{ count: 6 }]);

    const rows = await admin.query<{
      tripId: string;
      name: string;
      order: number;
      provider: string | null;
    }>(
      `SELECT "tripId", "name", "order", "provider"
         FROM "TripDestination" ORDER BY "tripId", "order"`,
    );
    const byTrip = new Map<string, Array<{ name: string; order: number; provider: string | null }>>();
    for (const row of rows.rows) {
      const list = byTrip.get(row.tripId) ?? [];
      list.push({ name: row.name, order: row.order, provider: row.provider });
      byTrip.set(row.tripId, list);
    }

    expect(byTrip.get(TRIP_SINGLE)).toEqual([{ name: "东京", order: 0, provider: null }]);
    expect(byTrip.get(TRIP_TWO)).toEqual([
      { name: "京都", order: 0, provider: null },
      { name: "大阪", order: 1, provider: null },
    ]);
    expect(byTrip.get(TRIP_THREE)?.map((row) => row.name)).toEqual(["巴黎", "里昂", "尼斯"]);
    expect(byTrip.get(TRIP_THREE)?.map((row) => row.order)).toEqual([0, 1, 2]);
    // An empty legacy array produces no rows, not a phantom destination.
    expect(byTrip.get(TRIP_EMPTY)).toBeUndefined();

    // The deprecated column is preserved verbatim: migration only reads it.
    const legacy = await admin.query(
      `SELECT "destinations" FROM "Trip" WHERE "id" = $1`,
      [TRIP_TWO],
    );
    expect(legacy.rows).toEqual([{ destinations: ["京都", "大阪"] }]);

    const deprecated = await admin.query<{ description: string | null }>(
      `SELECT col_description('"${dataSchema}"."Trip"'::regclass, attnum) AS description
         FROM pg_attribute
        WHERE attrelid = '"${dataSchema}"."Trip"'::regclass
          AND attname = 'destinations'`,
    );
    expect(deprecated.rows[0]?.description ?? "").toContain("DEPRECATED");

    // IDs are UUIDv7-shaped so `TripDestinationSchema` can read the rows.
    const versions = await admin.query<{ version_nibble: string; variant_nibble: string }>(
      `SELECT substr("id"::text, 15, 1) AS version_nibble,
              substr("id"::text, 20, 1) AS variant_nibble
         FROM "TripDestination"`,
    );
    expect(new Set(versions.rows.map((row) => row.version_nibble))).toEqual(new Set(["7"]));
    expect(
      versions.rows.every((row) => ["8", "9", "a", "b"].includes(row.variant_nibble)),
    ).toBe(true);
  });

  it("rejects rows outside the contract with the named CHECKs", async () => {
    await admin.query(`SET search_path TO "${dataSchema}"`);

    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "provider", "order", "createdAt"`,
            `(${quote(DEST_ID)}, $1, 'name', 'unknown', 5, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23514",
      "TripDestination_provider_check",
    );

    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "countryCode", "order", "createdAt"`,
            `(${quote(DEST_ID)}, $1, 'name', 'jp', 5, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23514",
      "TripDestination_country_code_check",
    );

    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "lat", "lng", "order", "createdAt"`,
            `(${quote(DEST_ID)}, $1, 'name', 95, 135.7, 5, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23514",
      "TripDestination_lat_range_check",
    );

    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "lat", "order", "createdAt"`,
            `(${quote(DEST_ID)}, $1, 'name', 35.0, 5, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23514",
      "TripDestination_coords_pair_check",
    );

    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "order", "createdAt"`,
            `(${quote(DEST_ID)}, $1, 'name', -1, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23514",
      "TripDestination_order_nonnegative_check",
    );

    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "bbox", "order", "createdAt"`,
            `(${quote(DEST_ID)}, $1, 'name', '[135.6, 34.85, 135.93]'::jsonb, 5, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23514",
      "TripDestination_bbox_shape_check",
    );
  });

  it("enforces one active position per trip while allowing reused positions", async () => {
    await admin.query(`SET search_path TO "${dataSchema}"`);

    // TRIP_SINGLE already has active order 0 from the backfill.
    await expectViolation(
      admin,
      () =>
        admin.query(
          insertDestinationSql(
            `"name", "order", "createdAt"`,
            `(${quote(DEST_ID_2)}, $1, 'duplicate position', 0, now())`,
          ),
          [TRIP_SINGLE],
        ),
      "23505",
      "TripDestination_tripId_order_active_key",
    );

    // The API's replace flow soft-deletes first, then reinserts at the same
    // position: the partial index must not block that.
    await inRolledBackTransaction(admin, async () => {
      await admin.query(
        `UPDATE "TripDestination" SET "deletedAt" = now()
          WHERE "tripId" = $1 AND "order" = 0 AND "deletedAt" IS NULL`,
        [TRIP_SINGLE],
      );
      await admin.query(
        insertDestinationSql(
          `"name", "provider", "order", "createdAt"`,
          `(${quote(DEST_ID_2)}, $1, 'replacement', 'local', 0, now())`,
        ),
        [TRIP_SINGLE],
      );
      const active = await admin.query(
        `SELECT "name" FROM "TripDestination"
          WHERE "tripId" = $1 AND "deletedAt" IS NULL`,
        [TRIP_SINGLE],
      );
      expect(active.rows).toEqual([{ name: "replacement" }]);
      const all = await admin.query(
        `SELECT count(*)::int AS count FROM "TripDestination" WHERE "tripId" = $1`,
        [TRIP_SINGLE],
      );
      expect(all.rows).toEqual([{ count: 2 }]);
    });
  });

  it("cascades rows when a trip is hard-deleted", async () => {
    await admin.query(`SET search_path TO "${dataSchema}"`);
    await inRolledBackTransaction(admin, async () => {
      await admin.query(`DELETE FROM "Trip" WHERE "id" = $1`, [TRIP_TWO]);
      const remaining = await admin.query(
        `SELECT count(*)::int AS count FROM "TripDestination" WHERE "tripId" = $1`,
        [TRIP_TWO],
      );
      expect(remaining.rows).toEqual([{ count: 0 }]);
    });
  });
});

/** Minimal UUID literal helper that also keeps the INSERT helper readable. */
function quote(id: string): string {
  return `'${id}'::uuid`;
}
