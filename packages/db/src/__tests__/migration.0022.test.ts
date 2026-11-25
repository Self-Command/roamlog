import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((entry) => /^\d{4}_/u.test(entry))
  .sort();
const migrationName = "0022_appearance_enterprise_skins";
const rawSql = readFileSync(`${migrationsDir}/${migrationName}/migration.sql`, "utf8");

describe("0022_appearance_enterprise_skins migration", () => {
  it("sorts after every appearance migration it builds on", () => {
    const index = migrations.indexOf(migrationName);
    expect(index).toBeGreaterThanOrEqual(0);
    for (const earlier of [
      "0004_system_setting",
      "0017_user_appearance_preference",
      "0021_ai_conversation_visibility",
    ]) {
      expect(migrations.indexOf(earlier), earlier).toBeGreaterThanOrEqual(0);
      expect(migrations.indexOf(earlier), earlier).toBeLessThan(index);
    }
  });

  it("widens both preference checks without dropping legacy IDs", () => {
    expect(rawSql).toContain('"UserAppearancePreference_skin_check"');
    expect(rawSql).toContain('"UserAppearancePreference_font_pairing_check"');
    for (const skin of ["primer", "fluent", "carbon", "carbon-soft", "catppuccin"]) {
      expect(rawSql).toContain(`'${skin}'`);
    }
    for (const font of [
      "primer-system",
      "primer-cjk",
      "fluent-native",
      "carbon-plex",
      "editorial-classic",
    ]) {
      expect(rawSql).toContain(`'${font}'`);
    }
  });

  it("rewrites only legacy platform defaults and leaves user rows intact", () => {
    expect(rawSql).toContain(`"key" = 'theme.defaultSkin'`);
    expect(rawSql).toContain(`"key" = 'theme.defaultFont'`);
    expect(rawSql).toContain(`to_jsonb('primer'::text)`);
    expect(rawSql).toContain(`to_jsonb('primer-system'::text)`);
    expect(rawSql).not.toMatch(/DELETE\s+FROM\s+"UserAppearancePreference"/iu);
  });
});
