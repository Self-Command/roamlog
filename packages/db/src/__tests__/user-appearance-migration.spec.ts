import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => !entry.startsWith("."))
  .sort();
const migrationName = "0017_user_appearance_preference";
const migrationPath = `${migrationsDir}/${migrationName}/migration.sql`;
const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

const rawSql = readFileSync(migrationPath, "utf8");
const sql = rawSql
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const schema = readFileSync(schemaPath, "utf8");

function modelBody(model: string): string {
  const match = schema.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) {
    throw new Error(`Missing model ${model}`);
  }
  return match[1];
}

describe("0017_user_appearance_preference migration", () => {
  it("sorts after 0016 and declares the one-to-one model", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThan(0);
    expect(migrations.indexOf("0016_provider_connections")).toBeLessThan(index);

    const body = modelBody("UserAppearancePreference");
    expect(body).toMatch(/userId\s+String\s+@id\s+@db\.Uuid/);
    expect(body).toMatch(/mode\s+String\?\s+@db\.VarChar\(16\)/);
    expect(body).toMatch(/skin\s+String\?\s+@db\.VarChar\(40\)/);
    expect(body).toMatch(/fontPairing\s+String\?\s+@db\.VarChar\(40\)/);
    expect(body).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
    expect(body).toMatch(/updatedAt\s+DateTime\s+@updatedAt\s+@db\.Timestamptz\(3\)/);
    expect(body).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/,
    );
    expect(body).toMatch(/@@map\("UserAppearancePreference"\)/);
    expect(modelBody("User")).toMatch(/appearancePreference\s+UserAppearancePreference\?/);
  });

  it("creates the nullable table, cascade FK and allow-list checks", () => {
    expect(sql).toContain('CREATE TABLE "UserAppearancePreference"');
    for (const line of [
      '"userId" UUID NOT NULL',
      '"mode" VARCHAR(16)',
      '"skin" VARCHAR(40)',
      '"fontPairing" VARCHAR(40)',
      '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
      '"updatedAt" TIMESTAMPTZ(3) NOT NULL',
      'CONSTRAINT "UserAppearancePreference_pkey" PRIMARY KEY ("userId")',
      'CONSTRAINT "UserAppearancePreference_mode_check"',
      'CONSTRAINT "UserAppearancePreference_skin_check"',
      'CONSTRAINT "UserAppearancePreference_font_pairing_check"',
      'FOREIGN KEY ("userId") REFERENCES "User"("id")',
      "ON DELETE CASCADE ON UPDATE CASCADE",
    ]) {
      expect(sql, line).toContain(line);
    }
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  });
});

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED 0017 user appearance integration test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

const USER_ID = "01942f30-1200-7000-8000-000000000971";

integration("0017_user_appearance_preference against PostgreSQL", () => {
  const schemaName = `appearance_it_${process.pid}_${Date.now().toString(36)}`;
  const client = new Client({ connectionString: testDatabaseUrl });

  afterAll(async () => {
    if (client.connection?.stream) {
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  });

  it("applies the chain and enforces null inheritance, uniqueness and cascade", async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);

    for (const name of migrations) {
      await client.query(readFileSync(`${migrationsDir}/${name}/migration.sql`, "utf8"));
    }

    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "updatedAt")
       VALUES ($1, 'appearance@roamlog.test', 'Appearance Test', NOW())`,
      [USER_ID],
    );

    await client.query(
      `INSERT INTO "UserAppearancePreference" ("userId", "updatedAt")
       VALUES ($1, NOW())`,
      [USER_ID],
    );
    const nullRow = await client.query<{
      mode: string | null;
      skin: string | null;
      fontPairing: string | null;
    }>(
      `SELECT "mode", "skin", "fontPairing"
         FROM "UserAppearancePreference"
        WHERE "userId" = $1`,
      [USER_ID],
    );
    expect(nullRow.rows[0]).toEqual({ mode: null, skin: null, fontPairing: null });

    await expect(
      client.query(
        `INSERT INTO "UserAppearancePreference" ("userId", "updatedAt")
         VALUES ($1, NOW())`,
        [USER_ID],
      ),
    ).rejects.toThrow(/duplicate key|unique constraint/i);

    for (const column of ["mode", "skin", "fontPairing"]) {
      const value = column === "mode" ? "sepia" : "not-a-theme";
      await expect(
        client.query(
          `UPDATE "UserAppearancePreference"
              SET "${column}" = $2, "updatedAt" = NOW()
            WHERE "userId" = $1`,
          [USER_ID, value],
        ),
      ).rejects.toThrow(/violates check constraint/i);
    }

    await client.query(
      `UPDATE "UserAppearancePreference"
          SET "mode" = 'light', "skin" = 'kanagawa',
              "fontPairing" = 'cjk-editorial', "updatedAt" = NOW()
        WHERE "userId" = $1`,
      [USER_ID],
    );

    await client.query(`DELETE FROM "User" WHERE "id" = $1`, [USER_ID]);
    const remaining = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "UserAppearancePreference" WHERE "userId" = $1`,
      [USER_ID],
    );
    expect(remaining.rows[0]?.count).toBe("0");
  });
});
