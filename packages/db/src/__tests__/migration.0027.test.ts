import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => /^\d{4}_/u.test(entry))
  .sort();
const migrationName = "0027_trendy_theme_catalog";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");

describe("0027_trendy_theme_catalog migration", () => {
  it("sorts after every appearance migration it builds on", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThanOrEqual(0);
    for (const earlier of [
      "0022_appearance_enterprise_skins",
      "0023_default_fluent_enterprise",
      "0024_user_facing_default_copy",
      "0025_porcelain_default_theme",
    ]) {
      expect(migrations.indexOf(earlier), earlier).toBeGreaterThanOrEqual(0);
      expect(migrations.indexOf(earlier), earlier).toBeLessThan(index);
    }
  });

  it("keeps every legacy skin legal while adding the trendy catalog", () => {
    expect(rawSql).toContain('"UserAppearancePreference_skin_check"');
    for (const skin of [
      "mist",
      "geist",
      "iris",
      "sandstone",
      "porcelain",
      "primer",
      "fluent",
      "carbon",
      "carbon-soft",
      "editorial-noir",
      "catppuccin",
      "tokyo-night",
      "rose-pine",
      "kanagawa",
      "everforest",
    ]) {
      expect(rawSql).toContain(`'${skin}'`);
    }
    expect(rawSql).not.toMatch(/DELETE\s+FROM\s+"UserAppearancePreference"/iu);
  });

  it("only rewrites the old platform default", () => {
    expect(rawSql).toContain(`"key" = 'theme.defaultSkin'`);
    expect(rawSql).toContain(`to_jsonb('porcelain'::text)`);
    expect(rawSql).toContain(`to_jsonb('mist'::text)`);
    expect(rawSql).not.toMatch(/WHERE\s+"key" = 'theme.defaultSkin'\s+AND\s+"value" IN/iu);
  });
});
