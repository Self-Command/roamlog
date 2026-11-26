/**
 * Enterprise product-surface adoption.
 *
 * Real Better Auth session, real API, real database and the current Web build.
 * Captures the working pages at desktop/mobile and light/dark, then asserts the
 * parts that must not regress: sans product chrome, no decorative page glow,
 * bounded title scale, local font stack and no horizontal overflow.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  provisionWorkspaceMember,
  signInViaApi,
  WEB_URL,
  type SmokeAccount,
} from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const WORKSPACE_SLUG = "roamlog-crew";
const OUT_DIR = path.join(process.cwd(), ".audit", "theme-enterprise", "adoption");
const EVIDENCE_FILE = path.join(OUT_DIR, "enterprise-adoption.json");

const AUDIT_ACCOUNT: SmokeAccount = {
  email: "theme-audit@roamlog.test",
  password: "Theme-Audit-Aa1!",
  name: "主题验收账号",
};
const ACCEPTANCE_SKIN = "mercury";

type Mode = "light" | "dark";
type Width = 1440 | 390;

interface SurfaceMetric {
  route: string;
  mode: Mode;
  width: Width;
  screenshot: string;
  background: string;
  bodyFont: string;
  title: string;
  titleFont: string;
  titleSize: number;
  glowCount: number;
  overflow: number;
}

const evidence: {
  generatedAt: string;
  workspace: string;
  surfaces: SurfaceMetric[];
  failures: string[];
} = {
  generatedAt: new Date().toISOString(),
  workspace: WORKSPACE_SLUG,
  surfaces: [],
  failures: [],
};

mkdirSync(OUT_DIR, { recursive: true });

function appearanceCookie(mode: Mode): string {
  return encodeURIComponent(
    JSON.stringify({
      v: 1,
      mode,
      skin: ACCEPTANCE_SKIN,
      fontPairing: "fluent-native",
    }),
  );
}

async function addAppearanceCookie(context: BrowserContext, mode: Mode): Promise<void> {
  await context.addCookies([
    {
      name: "roamlog_appearance",
      value: appearanceCookie(mode),
      domain: new URL(WEB_URL).hostname,
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

async function setUserMode(page: Page, mode: Mode): Promise<void> {
  const response = await page.request.put(`${WEB_URL}/v1/me/appearance`, {
    data: { mode, skin: ACCEPTANCE_SKIN, fontPairing: "fluent-native" },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * Keeps the visual acceptance rerunnable on a fresh local database without
 * deleting and recreating an account that already owns its own workspace.
 */
async function ensureAuditSession(page: Page): Promise<void> {
  try {
    await signInViaApi(page.request, AUDIT_ACCOUNT);
    return;
  } catch {
    // The local fixture may have been reset; provision the fixed audit member
    // once, then use the real API sign-in path.
  }
  provisionWorkspaceMember(AUDIT_ACCOUNT, WORKSPACE_SLUG, "admin");
  await signInViaApi(page.request, AUDIT_ACCOUNT);
}

async function readSurface(
  page: Page,
  routeName: string,
  mode: Mode,
  width: Width,
): Promise<SurfaceMetric> {
  await expect(page.locator("main h1:visible").first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const metric = await page.evaluate(() => {
    const title = Array.from(document.querySelectorAll<HTMLElement>("main h1")).find(
      (node) => node.offsetParent !== null,
    );
    const titleStyle = title ? getComputedStyle(title) : null;
    return {
      background: getComputedStyle(document.body).backgroundColor,
      bodyFont: getComputedStyle(document.body).fontFamily,
      title: title?.innerText.trim() ?? "",
      titleFont: titleStyle?.fontFamily ?? "",
      titleSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0,
      glowCount: document.querySelectorAll(".page-glow").length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  const screenshotPath = path.join(OUT_DIR, `${routeName}-${mode}-${width}.png`);
  await page.screenshot({
    path: screenshotPath,
    // Desktop evidence is a full work-surface; mobile evidence stays at the
    // real 844 px viewport so fixed navigation is not composited mid-page.
    fullPage: width === 1440,
    animations: "disabled",
  });

  const result: SurfaceMetric = {
    route: routeName,
    mode,
    width,
    screenshot: path.relative(process.cwd(), screenshotPath).split(path.sep).join("/"),
    ...metric,
  };
  evidence.surfaces.push(result);

  // Product chrome must stay sans. Journal article titles use the prose stack,
  // but the page H1 measured here is navigation chrome.
  expect(metric.title.length, `${routeName}: page title`).toBeGreaterThan(0);
  const readingFonts = /(instrument serif|newsreader|noto serif|songti|simsun)/iu;
  expect(metric.titleFont, `${routeName}: title font`).not.toMatch(readingFonts);
  expect(metric.bodyFont, `${routeName}: body font`).not.toMatch(readingFonts);
  expect(metric.titleSize, `${routeName}: title scale`).toBeLessThanOrEqual(
    routeName === "auth" ? 40 : 36,
  );
  expect(metric.glowCount, `${routeName}: page glow`).toBe(0);
  expect(metric.overflow, `${routeName}: horizontal overflow`).toBeLessThanOrEqual(1);

  return result;
}

async function captureGuestAuth(
  browser: Browser,
  mode: Mode,
  width: Width,
): Promise<SurfaceMetric> {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  await addAppearanceCookie(context, mode);
  const page = await context.newPage();
  try {
    await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    return await readSurface(page, "auth", mode, width);
  } finally {
    await context.close();
  }
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("enterprise product pages are usable at 1440/390 in light/dark", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    // Establish the real Better Auth session through the API, then exercise the
    // authenticated UI. This avoids a dev-only hydration race in the login form
    // clearing the email field before React attaches.
    await ensureAuditSession(page);

    const workspacesResponse = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
    expect(workspacesResponse.status(), await workspacesResponse.text()).toBe(200);
    const workspaces = (await workspacesResponse.json()) as Array<{ id: string; slug: string }>;
    const workspace = workspaces.find((item) => item.slug === WORKSPACE_SLUG) ?? workspaces[0];
    expect(workspace, "the audit account must see at least one workspace").toBeTruthy();
    evidence.workspace = workspace!.slug;

    const tripsResponse = await page.request.get(
      `${WEB_URL}/v1/workspaces/${workspace!.id}/trips?limit=1`,
    );
    expect(tripsResponse.status(), await tripsResponse.text()).toBe(200);
    const trips = (await tripsResponse.json()) as { items: Array<{ id: string; title: string }> };
    expect(trips.items[0], "the adoption run needs one real trip").toBeTruthy();

    const surfaces = [
      { name: "dashboard", path: `/w/${workspace!.slug}` },
      { name: "trips", path: `/w/${workspace!.slug}/trips` },
      { name: "trip-detail", path: `/w/${workspace!.slug}/trips/${trips.items[0]!.id}` },
      { name: "journal", path: `/w/${workspace!.slug}/journal` },
      { name: "settings", path: `/w/${workspace!.slug}/settings/profile` },
      { name: "ai", path: `/w/${workspace!.slug}/ai` },
    ] as const;

    for (const mode of ["light", "dark"] satisfies Mode[]) {
      await setUserMode(page, mode);
      for (const width of [1440, 390] satisfies Width[]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const surface of surfaces) {
          await page.goto(`${WEB_URL}${surface.path}`, { waitUntil: "domcontentloaded" });
          await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
          await expect(page.locator("html")).toHaveAttribute("data-skin", ACCEPTANCE_SKIN);
          await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");
          await readSurface(page, surface.name, mode, width);
          await expectNoHorizontalOverflow(page, `${surface.name} ${mode} ${width}`);
        }
      }
    }

    for (const mode of ["light", "dark"] satisfies Mode[]) {
      for (const width of [1440, 390] satisfies Width[]) {
        await captureGuestAuth(browser, mode, width);
      }
    }

    const key = (entry: SurfaceMetric) => `${entry.route}:${entry.width}`;
    const backgrounds = new Map<string, Set<string>>();
    for (const entry of evidence.surfaces) {
      const set = backgrounds.get(key(entry)) ?? new Set<string>();
      set.add(entry.background);
      backgrounds.set(key(entry), set);
    }
    for (const [surface, values] of backgrounds) {
      expect(values.size, `${surface}: light/dark backgrounds must differ`).toBe(2);
    }
  } finally {
    await page.request.delete(`${WEB_URL}/v1/me/appearance`).catch(() => undefined);
    await context.close();
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  }
});
