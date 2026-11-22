import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Production-surface guard for Stage A, Task 1.
 *
 * The web app has exactly one data source: the real API. No route may keep a
 * build-time `NEXT_PUBLIC_DATA_MODE` switch, and the retired `legacy-mock`
 * fixture boundary must not be reachable from the app tree.
 *
 * `process.cwd()` is `apps/web` because the tests run through
 * `pnpm --filter @roamlog/web`.
 */

const ROOT = join(process.cwd(), "app");
// `data-mode` is now the appearance contract written by the root layout. The
// retired build-time switch is the uppercase `DATA_MODE` symbol; do not ban the
// legitimate appearance attribute.
const FORBIDDEN = [/DATA_MODE/, /legacy-mock/, /api-mocks/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Routes that used to branch between a live component and a lazy mock workspace. */
const LIVE_ROUTES = [
  "app/(app)/w/[workspaceSlug]/journal/page.tsx",
  "app/(app)/w/[workspaceSlug]/members/page.tsx",
  "app/(app)/w/[workspaceSlug]/notifications/page.tsx",
  "app/(app)/w/[workspaceSlug]/settings/page.tsx",
  "app/(app)/w/[workspaceSlug]/activity/page.tsx",
  "app/(app)/w/[workspaceSlug]/trips/[tripId]/page.tsx",
  "app/(app)/w/[workspaceSlug]/trips/[tripId]/map/page.tsx",
];

describe("app routes carry no legacy data-source switch", () => {
  it("imports no legacy data-mode module", () => {
    for (const file of walk(ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("statically renders the live component from every former branching route", () => {
    for (const route of LIVE_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, `${route} still lazy-loads a component`).not.toMatch(/next\/dynamic/);
      expect(source, `${route} still renders a legacy component`).not.toMatch(/Legacy/);
    }
  });
});

/** Every source file under the given app directories, recursively. */
function walkAll(dirs: string[]): string[] {
  const files: string[] = [];
  const stack = dirs.map((dir) => join(process.cwd(), dir));
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files;
}

describe("no dead mock surface", () => {
  it("has no dead mock branches and no DataMode type", () => {
    for (const file of walkAll(["components", "lib"])) {
      if (file.includes(".test.")) continue;
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/mode\s*===\s*["']mock["']/);
      expect(src, file).not.toMatch(/useDataMode|DataMode/);
      expect(src, file).not.toMatch(/本地演示数据|LIVE API/);
    }
  });
});

describe("the retired demo boundary is gone", () => {
  it("has no legacy-mock directory", () => {
    expect(existsSync(join(process.cwd(), "components/legacy-mock"))).toBe(false);
  });

  it("has no data-mode module", () => {
    expect(existsSync(join(process.cwd(), "lib/data-mode.ts"))).toBe(false);
  });

  it("keeps only the React Query shell in providers", () => {
    const source = readFileSync(join(process.cwd(), "components/providers.tsx"), "utf8");
    expect(source).not.toMatch(/legacy-mock/);
    expect(source).not.toMatch(/NEXT_PUBLIC_DATA_MODE/);
    expect(source).not.toMatch(/MockBootScreen|LegacyMockRoot|startMockWorker/);
    expect(source).toMatch(/QueryClientProvider/);
  });
});

/**
 * The web app must never depend on the shared mock package again.
 *
 * Built at runtime on purpose: a literal spelling of the retired package name
 * would make the whole-app dependency sweep match this guard itself, so the
 * dependency we just removed would still look alive to that sweep.
 */
const RETIRED_MOCK_PACKAGE = ["@roamlog", "api-mocks"].join("/");

describe("the shared mock package is not a web dependency", () => {
  it("is absent from both dependencies and devDependencies", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(declared).not.toContain(RETIRED_MOCK_PACKAGE);
  });
});
