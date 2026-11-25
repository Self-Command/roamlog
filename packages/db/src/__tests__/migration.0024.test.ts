import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../prisma/migrations/0024_user_facing_default_copy/migration.sql", import.meta.url),
);
const rawSql = readFileSync(migrationPath, "utf8");

describe("0024_user_facing_default_copy migration", () => {
  it("only replaces the previous English defaults", () => {
    expect(rawSql).toContain(`"key" = 'site.description'`);
    expect(rawSql).toContain(`"key" = 'seo.descriptionTemplate'`);
    expect(rawSql).toContain(`"key" = 'theme.loginTagline'`);
    expect(rawSql).toContain("A collaborative travel journal for the trips you take together.");
    expect(rawSql).toContain("Plan trips, keep a journal, and remember every stop together.");
    expect(rawSql).toContain("Every trip deserves a memory.");
    expect(rawSql).toContain("和同行者一起规划行程、记录旅途，把每一次出发留存下来。");
    expect(rawSql).toContain("把每次旅行留下来。");
    expect(rawSql).not.toMatch(/DELETE\s+FROM\s+"SystemSetting"/iu);
  });
});
