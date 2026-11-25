/**
 * Enterprise Admin console acceptance.
 *
 * Real Better Auth session, real Admin app, real API and PostgreSQL. The
 * screenshots are kept under `.audit/theme-enterprise/admin-appearance/` so the
 * root acceptance can inspect the same surfaces that were asserted.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_URL,
  API_URL,
  WEB_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  enableSuperAdminTotp,
  loginOnAdmin,
  provisionSuperAdmin,
} from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";
import { uniqueRunId } from "../support/smoke";

const OUT_DIR = path.resolve(
  process.cwd(),
  ".audit",
  "theme-enterprise",
  "admin-appearance",
);
const EVIDENCE_FILE = path.join(OUT_DIR, "admin-appearance.json");
const runId = uniqueRunId();
const superAdmin = createSuperAdminAccount(runId);

interface SurfaceEvidence {
  name: string;
  route: string;
  viewport: string;
  screenshot: string;
  title: string;
  titleFont: string;
  titleSize: number;
  overflow: number;
  backgroundColor: string;
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
let totpSecret = "";

test.describe.configure({ mode: "serial", timeout: 300_000 });

async function shot(
  pageToCapture: Page,
  name: string,
  route: string,
  viewport: string,
  fullPage = true,
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
      backgroundColor: getComputedStyle(document.body).backgroundColor,
    };
  });
  evidence.surfaces.push({
    name,
    route,
    viewport,
    screenshot: path.relative(process.cwd(), target).split(path.sep).join("/"),
    ...metrics,
  });
}

async function loginAsSuperAdmin(pageToUse: Page): Promise<void> {
  await pageToUse.route("**/v1/auth/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      pathname !== "/v1/auth/sign-in/email" &&
      pathname !== "/v1/auth/two-factor/verify-totp"
    ) {
      await route.continue();
      return;
    }
    const response = await route.fetch({
      url: `${API_URL}${pathname}`,
      method: request.method(),
      headers: { "content-type": "application/json", origin: WEB_URL },
      postData: request.postData(),
    });
    await route.fulfill({ response });
  });
  await loginOnAdmin(pageToUse, superAdmin, totpSecret);
  await expect(pageToUse.getByRole("navigation", { name: "管理后台主导航" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("enterprise Admin console", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    provisionSuperAdmin(superAdmin);
    totpSecret = await enableSuperAdminTotp(superAdmin);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();

    await page.goto(`${ADMIN_URL}/admin/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "进入平台控制台" })).toBeVisible();
    const loginTitleFont = await page.evaluate(
      () => getComputedStyle(document.querySelector("h1")!).fontFamily,
    );
    expect(loginTitleFont).toContain("IBM Plex Sans");
    await shot(page, "admin-login-1440", "/admin/login", "1440x1000");
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, "admin login 390");
    await shot(page, "admin-login-390", "/admin/login", "390x844");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await loginAsSuperAdmin(page);
  });

  test.afterAll(async () => {
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close();
    deleteSuperAdmin(superAdmin.email);
  });

  test("keeps the fixed Carbon shell readable across overview, users and appearance defaults", async () => {
    await page.goto(`${ADMIN_URL}/admin`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".admin-atmosphere")).toHaveCount(0);
    await expect(page.locator(".page-glow:visible")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-skin", "carbon");
    await expect(page.locator("html")).toHaveAttribute("data-font", "carbon-plex");
    await shot(page, "admin-overview-1440", "/admin", "1440x1000");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, "admin overview 390");
    await shot(page, "admin-overview-390", "/admin", "390x844");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(`${ADMIN_URL}/admin/users`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "用户" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.locator("thead tr").first()).not.toHaveClass(/font-mono/u);
    await shot(page, "admin-users-1440", "/admin/users", "1440x1000");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, "admin users 390");
    await shot(page, "admin-users-390", "/admin/users", "390x844");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto(`${ADMIN_URL}/admin/settings?tab=theme`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "外观与字体" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("radiogroup", { name: "默认主题" }).locator('[role="radio"]'),
    ).toHaveCount(4);
    await expect(page.getByText(/4 套企业主题/u)).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "默认字体" }).locator('[role="radio"]'),
    ).toHaveCount(4);
    await expect(page.getByTestId("admin-appearance-workbench-preview-system")).toBeVisible();
    await expect(page.getByText("六套皮肤")).toHaveCount(0);
    await shot(page, "admin-settings-appearance-1440", "/admin/settings?tab=theme", "1440x1000");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, "admin appearance 390");
    await shot(page, "admin-settings-appearance-390", "/admin/settings?tab=theme", "390x844");

    for (const surface of evidence.surfaces) {
      expect(surface.titleFont).toContain("IBM Plex Sans");
      expect(surface.titleSize).toBeLessThanOrEqual(36);
      expect(surface.overflow).toBeLessThanOrEqual(1);
    }
  });
});
