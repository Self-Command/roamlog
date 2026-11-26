import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, findWorkspace, loginOnWeb } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const OUT_DIR = path.join(process.cwd(), ".audit", "theme-enterprise", "product-adoption");
const EVIDENCE_FILE = path.join(OUT_DIR, "product-adoption.json");
const ACCEPTANCE_SKIN = "mercury";

test.use({ trace: "off", video: "off" });
test.describe.configure({ mode: "serial" });

interface Evidence {
  generatedAt: string;
  surfaces: Array<{
    name: string;
    title: string;
    titleSize: number;
    titleFont: string;
    overflow: number;
    glareVisible: number;
    screenshot: string;
  }>;
}

const evidence: Evidence = { generatedAt: "", surfaces: [] };

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
}

async function capture(page: Page, name: string): Promise<void> {
  await settle(page);
  await expectNoHorizontalOverflow(page);
  const title = page.locator("main h1").first();
  await expect(title).toBeVisible();
  const metrics = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: element.textContent?.trim() ?? "",
      fontSize: Number.parseFloat(style.fontSize),
      fontFamily: style.fontFamily,
    };
  });
  expect(metrics.fontSize).toBeLessThanOrEqual(36);
  expect(metrics.fontFamily).not.toMatch(/Instrument|Newsreader|Fraunces/iu);
  expect(await page.locator(".page-glow:visible").count()).toBe(0);

  const screenshot = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  evidence.surfaces.push({
    name,
    title: metrics.text,
    titleSize: metrics.fontSize,
    titleFont: metrics.fontFamily,
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    glareVisible: await page.locator(".page-glow:visible").count(),
    screenshot: path.relative(process.cwd(), screenshot).split(path.sep).join("/"),
  });
}

async function forceDark(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.mode = "dark";
    document.documentElement.style.colorScheme = "dark";
  });
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  evidence.generatedAt = new Date().toISOString();
});

test.afterAll(() => {
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
});

test("enterprise product surfaces use compact sans chrome and no glow", async ({ page }) => {
  test.setTimeout(180_000);
  await page.context().addCookies([
    {
      name: "roamlog_appearance",
      value: encodeURIComponent(
        JSON.stringify({
          v: 1,
          mode: "light",
          skin: ACCEPTANCE_SKIN,
          fontPairing: "fluent-native",
        }),
      ),
      domain: new URL(WEB_URL).hostname,
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-skin", ACCEPTANCE_SKIN);
  await capture(page, "auth-1440-light");

  await loginOnWeb(page, OWNER_ACCOUNT);
  const workspace = await findWorkspace(page.request);

  await page.goto(`${WEB_URL}/w/${workspace.slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-skin", ACCEPTANCE_SKIN);
  await capture(page, "dashboard-1440-light");

  await forceDark(page);
  await capture(page, "dashboard-1440-dark");

  await page.goto(`${WEB_URL}/w/${workspace.slug}/trips`, { waitUntil: "domcontentloaded" });
  await capture(page, "trips-1440-light");

  const tripsResponse = await page.request.get(
    `${WEB_URL}/v1/workspaces/${workspace.id}/trips?limit=1`,
  );
  expect(tripsResponse.status(), await tripsResponse.text()).toBe(200);
  const trips = (await tripsResponse.json()) as { items: Array<{ id: string }> };
  if (trips.items[0]) {
    await page.goto(`${WEB_URL}/w/${workspace.slug}/trips/${trips.items[0].id}`, {
      waitUntil: "domcontentloaded",
    });
    await capture(page, "trip-detail-1440-light");
  }

  await page.goto(`${WEB_URL}/w/${workspace.slug}/journal`, { waitUntil: "domcontentloaded" });
  await capture(page, "journal-1440-light");

  await page.goto(`${WEB_URL}/w/${workspace.slug}/settings`, { waitUntil: "domcontentloaded" });
  await capture(page, "settings-1440-light");

  await forceDark(page);
  await capture(page, "settings-1440-dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB_URL}/w/${workspace.slug}`, { waitUntil: "domcontentloaded" });
  await capture(page, "dashboard-390-light");

  await page.goto(`${WEB_URL}/w/${workspace.slug}/trips`, { waitUntil: "domcontentloaded" });
  await capture(page, "trips-390-light");

  await page.goto(`${WEB_URL}/w/${workspace.slug}/settings`, { waitUntil: "domcontentloaded" });
  await capture(page, "settings-390-light");
});
