import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the fixture boundary.
 *
 * Demo/fixture code must never be reachable through a static import from a
 * production module. It may only be loaded through `next/dynamic` inside a
 * build-time `NEXT_PUBLIC_DATA_MODE` branch, or from test files.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "public",
  "scripts",
]);

/** Modules that carry fixture data themselves — they are the lazy boundary payload. */
const FIXTURE_MODULES = new Set(["lib/demo-store.tsx", "lib/msw.ts"]);

const FIXTURE_PACKAGES = ["@/lib/demo-store", "@roamlog/api-mocks"];

/**
 * Mock modules that still live outside `legacy-mock/` and static-import
 * `@/lib/demo-store`. They are already lazy-loaded from their route pages, so
 * they do not reach an api build; they are recorded here so the guard stays
 * green while the owning agents migrate them. This list must only shrink.
 */
const KNOWN_LEGACY_VIOLATIONS = [
  "components/activity/activity-workspace.tsx",
  "components/journal/journal-compose-dialog.tsx",
  "components/journal/journal-entry-sheet.tsx",
  "components/journal/journal-workspace.tsx",
  "components/members/members-workspace.tsx",
  "components/notifications/notifications-workspace.tsx",
  "components/settings/settings-workspace.tsx",
];

const MOCK_WORKSPACE_MODULES = [
  "@/components/activity/activity-workspace",
  "@/components/journal/journal-workspace",
  "@/components/members/members-workspace",
  "@/components/notifications/notifications-workspace",
  "@/components/settings/settings-workspace",
];

const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?[\s\S]*?from\s+["']([^"']+)["']/gm;

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function collectSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      collectSourceFiles(join(directory, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    files.push(join(directory, entry.name));
  }
  return files;
}

function relativeToWebRoot(file: string): string {
  return toPosix(relative(WEB_ROOT, file));
}

function isTestFile(relativePath: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(relativePath) ||
    relativePath.startsWith("test/") ||
    /\.test\.(?:ts|tsx|js|jsx)$/.test(relativePath) ||
    /\.spec\.(?:ts|tsx|js|jsx)$/.test(relativePath)
  );
}

function isInsideLegacyMock(relativePath: string): boolean {
  return relativePath.startsWith("components/legacy-mock/");
}

function isFixturePackage(target: string): boolean {
  return FIXTURE_PACKAGES.some(
    (fixturePackage) => target === fixturePackage || target.startsWith(`${fixturePackage}/`),
  );
}

/** Returns the fixture package targets that are statically imported by `source`. */
function staticFixtureImports(source: string): string[] {
  const matches: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const isTypeOnly = Boolean(match[1]);
    const target = match[2] ?? "";
    if (isTypeOnly) continue;
    if (isFixturePackage(target)) matches.push(target);
  }
  return matches;
}

describe("fixture isolation", () => {
  const sourceFiles = collectSourceFiles(WEB_ROOT).map((file) => ({
    file,
    relativePath: relativeToWebRoot(file),
  }));

  it("only allows static fixture imports inside legacy-mock/ and test files", () => {
    const violations = sourceFiles
      .filter(
        ({ relativePath }) =>
          !isInsideLegacyMock(relativePath) &&
          !isTestFile(relativePath) &&
          !FIXTURE_MODULES.has(relativePath),
      )
      .map(({ file, relativePath }) => ({
        relativePath,
        targets: staticFixtureImports(readFileSync(file, "utf8")),
      }))
      .filter(({ targets }) => targets.length > 0)
      .map(({ relativePath }) => relativePath)
      .filter((relativePath) => !KNOWN_LEGACY_VIOLATIONS.includes(relativePath));

    expect(violations).toEqual([]);
  });

  it("keeps the documented legacy violations list honest (it may only shrink)", () => {
    for (const relativePath of KNOWN_LEGACY_VIOLATIONS) {
      const absolutePath = join(WEB_ROOT, relativePath);
      expect(existsSync(absolutePath), `${relativePath} is gone — drop it from the list`).toBe(
        true,
      );
      expect(
        statSync(absolutePath).isFile(),
        `${relativePath} is not a file — drop it from the list`,
      ).toBe(true);
      expect(
        staticFixtureImports(readFileSync(absolutePath, "utf8")),
        `${relativePath} no longer imports fixtures — drop it from the list`,
      ).not.toHaveLength(0);
    }
  });

  it("never statically imports the legacy mock tree from a route", () => {
    const routeViolations = sourceFiles
      .filter(({ relativePath }) => relativePath.startsWith("app/") && !isTestFile(relativePath))
      .map(({ file, relativePath }) => ({
        relativePath,
        targets: [...readFileSync(file, "utf8").matchAll(IMPORT_RE)]
          .filter((match) => !match[1])
          .map((match) => match[2] ?? "")
          .filter(
            (target) =>
              target.startsWith("@/components/legacy-mock") ||
              MOCK_WORKSPACE_MODULES.includes(target),
          ),
      }))
      .filter(({ targets }) => targets.length > 0)
      .map(({ relativePath, targets }) => `${relativePath} → ${targets.join(", ")}`);

    expect(routeViolations).toEqual([]);
  });

  it("loads the demo store through next/dynamic behind the mock gate in providers.tsx", () => {
    const providers = readFileSync(join(WEB_ROOT, "components/providers.tsx"), "utf8");

    expect(staticFixtureImports(providers)).toEqual([]);
    expect(providers).toMatch(/dynamic\(|lazy\(/);
    expect(providers).toContain('DATA_MODE === "mock"');
    expect(providers).toContain('process.env.NODE_ENV !== "production"');
    // The dynamic target must be the legacy boundary, not demo-store directly.
    expect(providers).toContain("@/components/legacy-mock/mock-root");
    // Build-time gate so api builds can constant-fold the demo branch away.
    expect(providers).toContain('process.env.NEXT_PUBLIC_DATA_MODE === "api"');
    // Mount gate depends on the data mode only: a production `next build` in
    // mock mode must still mount DemoDataProvider.
    expect(providers).toMatch(/const mockModeEnabled = DATA_MODE === "mock";/);
    expect(providers).toContain("{mockModeEnabled && LegacyMockRoot ?");
    // NODE_ENV may only gate MSW, never the demo provider mount.
    expect(providers).toMatch(
      /const mswEnabled = mockModeEnabled && process\.env\.NODE_ENV !== "production";/,
    );
  });

  it("documents the legacy-mock boundary in its README", () => {
    const readme = join(WEB_ROOT, "components/legacy-mock/README.md");
    expect(existsSync(readme)).toBe(true);
    const content = readFileSync(readme, "utf8");
    expect(content).toContain("生产");
    expect(content).toMatch(/WEB_TRIP_WORKSPACE|删除/);
  });
});
