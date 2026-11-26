/**
 * Enterprise appearance picker acceptance.
 *
 * Real owner session, real API and PostgreSQL. The picker is asserted as a
 * workplace preference surface (light/dark/system, enterprise themes, local
 * fonts and a workspace preview), not a consumer theme store.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SKIN_CATALOG } from "@roamlog/contracts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  findWorkspace,
  signInViaApi,
} from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const OUT_DIR = path.resolve(process.cwd(), ".audit", "theme-enterprise", "admin-appearance");
const EVIDENCE_FILE = path.join(OUT_DIR, "web-appearance.json");
const APPEARANCE_URL = process.env.E2E_APPEARANCE_URL ?? WEB_URL;
const ACTIVE_SKINS = SKIN_CATALOG.filter((entry) => entry.status === "active");

interface SurfaceEvidence {
  name: string;
  viewport: string;
  screenshot: string;
  title: string;
  titleFont: string;
  titleSize: number;
  overflow: number;
  background: string;
}

const evidence: {
  generatedAt: string;
  surfaces: SurfaceEvidence[];
  failures: string[];
} = {
  generatedAt: new Date().toISOString(),
  surfaces: [],
  failures: [],
};

mkdirSync(OUT_DIR, { recursive: true });

let context: BrowserContext;
let page: Page;
let workspaceSlug = "";

test.describe.configure({ mode: "serial", timeout: 240_000 });

async function shot(
  pageToCapture: Page,
  name: string,
  viewport: string,
  fullPage = false,
): Promise<void> {
  await pageToCapture.evaluate(async () => {
    await document.fonts.ready;
  });
  const target = path.join(OUT_DIR, `${name}.png`);
  await pageToCapture.screenshot({
    path: target,
    fullPage,
    animations: "disabled",
  });
  const metrics = await pageToCapture.evaluate(() => {
    const heading = document.querySelector("h1");
    const style = heading ? getComputedStyle(heading) : null;
    return {
      title: heading?.textContent?.trim() ?? "",
      titleFont: style?.fontFamily ?? "",
      titleSize: style ? Number.parseFloat(style.fontSize) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      background: getComputedStyle(document.body).backgroundColor,
    };
  });
  evidence.surfaces.push({
    name,
    viewport,
    screenshot: path.relative(process.cwd(), target).split(path.sep).join("/"),
    ...metrics,
  });
}

test.describe("enterprise appearance picker", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    await signInViaApi(page.request, OWNER_ACCOUNT, WEB_URL, API_URL);
    const workspace = await findWorkspace(page.request);
    workspaceSlug = workspace.slug;
  });

  test.afterAll(async () => {
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close();
  });

  test("presents enterprise themes, system mode and a workspace preview", async () => {
    await page.goto(`${APPEARANCE_URL}/w/${workspaceSlug}/settings/appearance`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "外观", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("radiogroup", { name: "显示模式" }).locator('[role="radio"]'),
    ).toHaveCount(3);
    await expect(
      page.getByRole("radiogroup", { name: "主题" }).locator('[role="radio"]'),
    ).toHaveCount(ACTIVE_SKINS.length);
    await expect(
      page.getByText(`${ACTIVE_SKINS.length} 个主题`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /Mercury 墨紫/u })).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "字体配对" }).locator('[role="radio"]'),
    ).toHaveCount(4);
    const workspacePreview = page.locator(
      '[data-testid="appearance-workspace-preview-system"], [data-testid="appearance-workspace-preview-single"]',
    );
    await expect(workspacePreview).toBeVisible();
    await expect(page.getByText("京都工作台")).toHaveCount(0);
    await expect(page.getByText("Travel notes, 2026")).toHaveCount(0);
    await shot(page, "web-settings-appearance-1440-light", "1440x1000");
    await page.getByRole("radiogroup", { name: "字体配对" }).scrollIntoViewIfNeeded();
    await shot(page, "web-settings-appearance-1440-fonts", "1440x1000");

    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.getByRole("radio", { name: "深色" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await shot(page, "web-settings-appearance-1440-dark", "1440x1000");

    await page.getByRole("radio", { name: "跟随系统" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expectNoHorizontalOverflow(page, "web appearance 390");
    await shot(page, "web-settings-appearance-390", "390x844");
    await workspacePreview.scrollIntoViewIfNeeded();
    await shot(page, "web-settings-appearance-390-preview", "390x844");

    for (const surface of evidence.surfaces) {
      expect(surface.titleFont).not.toMatch(/(?:Instrument|Newsreader|Georgia|Songti|SimSun)/iu);
      expect(surface.titleSize).toBeLessThanOrEqual(36);
      expect(surface.overflow).toBeLessThanOrEqual(1);
    }
  });
});
