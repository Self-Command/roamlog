import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => /^\d{4}_/u.test(entry))
  .sort();
const migrationName = "0023_default_fluent_enterprise";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");

describe("0023_default_fluent_enterprise migration", () => {
  it("sorts after the enterprise appearance catalog", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(migrations.indexOf("0022_appearance_enterprise_skins")).toBeLessThan(index);
  });

  it("only rewrites the previous platform defaults", () => {
    expect(rawSql).toContain(`"key" = 'theme.defaultSkin'`);
    expect(rawSql).toContain(`"key" = 'theme.defaultFont'`);
    expect(rawSql).toContain(`to_jsonb('primer'::text)`);
    expect(rawSql).toContain(`to_jsonb('primer-system'::text)`);
    expect(rawSql).toContain(`to_jsonb('fluent'::text)`);
    expect(rawSql).toContain(`to_jsonb('fluent-native'::text)`);
    expect(rawSql).not.toMatch(/DELETE\s+FROM\s+"UserAppearancePreference"/iu);
  });
});
