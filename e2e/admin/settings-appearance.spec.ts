/**
 * Admin appearance defaults acceptance.
 *
 * The Admin console is intentionally a fixed dark operational shell. This
 * suite proves that the Web defaults can be changed without changing the
 * Admin `<html>` appearance, and that the saved defaults survive a reload.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_URL,
  API_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  enableSuperAdminTotp,
  loginOnAdmin,
  provisionSuperAdmin,
  WEB_URL,
} from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";
import { uniqueRunId } from "../support/smoke";

const EVIDENCE_DIR = path.join(process.cwd(), ".audit", "theme-font");
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, "appearance-admin-e2e.json");
const runId = uniqueRunId();
const superAdmin = createSuperAdminAccount(runId);

const SKINS = [
  { id: "mist", label: "Mist 雾蓝" },
  { id: "geist", label: "Geist 单色" },
  { id: "iris", label: "Iris 鸢尾" },
  { id: "sandstone", label: "Sandstone 砂岩" },
  { id: "porcelain", label: "Porcelain 原生瓷白" },
  { id: "fluent", label: "Fluent 2 原生企业" },
  { id: "carbon", label: "IBM Carbon" },
  { id: "carbon-soft", label: "Carbon 柔和灰阶" },
] as const;

const FONT_PAIRINGS = [
  { id: "primer-system", label: "Primer 系统" },
  { id: "primer-cjk", label: "Primer 中文" },
  { id: "fluent-native", label: "Fluent 原生" },
  { id: "carbon-plex", label: "Carbon Plex" },
] as const;

interface ThemeSettingItem {
  key: string;
  value?: unknown;
  default?: unknown;
  envLocked?: boolean;
}

interface SettingsResponse {
  groups?: Array<{
    group: string;
    items?: ThemeSettingItem[];
  }>;
}

interface Evidence {
  generatedAt: string;
  shellBefore: Record<string, string>;
  shellAfter: Record<string, string>;
  savedDefaults: Record<string, unknown>;
  screenshots: string[];
  externalFontRequests: string[];
}

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  shellBefore: {},
  shellAfter: {},
  savedDefaults: {},
  screenshots: [],
  externalFontRequests: [],
};

mkdirSync(EVIDENCE_DIR, { recursive: true });

let context: BrowserContext;
let page: Page;
let superAdminTotpSecret = "";
let originalThemeValues: Record<string, unknown> = {};
const fontRequests: string[] = [];

test.describe.configure({ mode: "serial", timeout: 240_000 });

async function chooseRadio(pageToUse: Page, groupName: string, label: string): Promise<void> {
  const group = pageToUse.getByRole("radiogroup", { name: groupName });
  const option = group.locator('[role="radio"]').filter({ hasText: label });
  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");
}

async function readSettings(pageToUse: Page): Promise<SettingsResponse> {
  const result = await pageToUse.evaluate(async () => {
    const response = await fetch("/v1/admin/settings", {
      headers: { Accept: "application/json" },
    });
    return {
      status: response.status,
      body: (await response.json()) as SettingsResponse,
    };
  });
  expect(result.status).toBe(200);
  return result.body;
}

function themeItems(response: SettingsResponse): ThemeSettingItem[] {
  return response.groups?.find((group) => group.group === "theme")?.items ?? [];
}

function themeValue(items: readonly ThemeSettingItem[], key: string): unknown {
  const item = items.find((entry) => entry.key === key);
  return item?.value ?? item?.default;
}

async function restoreThemeValues(pageToUse: Page, values: Record<string, unknown>): Promise<void> {
  const updates = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value }));
  const result = await pageToUse.evaluate(async (nextUpdates) => {
    const response = await fetch("/v1/admin/settings", {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ updates: nextUpdates }),
    });
    return { status: response.status, text: await response.text() };
  }, updates);
  expect(result.status, result.text).toBe(200);
}

async function shot(pageToCapture: Page, name: string, fullPage = true): Promise<string> {
  await pageToCapture.evaluate(async () => {
    await document.fonts.ready;
  });
  const target = path.join(EVIDENCE_DIR, name);
  await pageToCapture.screenshot({
    path: target,
    fullPage,
    animations: "disabled",
  });
  return path.relative(process.cwd(), target).split(path.sep).join("/");
}

function isExternalAdminFont(url: string): boolean {
  if (/fonts\.(?:googleapis|gstatic)\.com/iu.test(url)) return true;
  try {
    return new URL(url).origin !== new URL(ADMIN_URL).origin;
  } catch {
    return true;
  }
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
  await loginOnAdmin(pageToUse, superAdmin, superAdminTotpSecret);
  await expect(pageToUse.getByRole("navigation", { name: "管理后台主导航" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("admin appearance defaults", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    provisionSuperAdmin(superAdmin);
    superAdminTotpSecret = await enableSuperAdminTotp(superAdmin);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on("request", (request) => {
      if (request.resourceType() === "font") {
        fontRequests.push(request.url());
      }
    });
    await loginAsSuperAdmin(page);
    const settings = await readSettings(page);
    const items = themeItems(settings);
    originalThemeValues = {
      "theme.defaultMode": themeValue(items, "theme.defaultMode"),
      "theme.defaultSkin": themeValue(items, "theme.defaultSkin"),
      "theme.defaultFont": themeValue(items, "theme.defaultFont"),
      "theme.allowUserOverride": themeValue(items, "theme.allowUserOverride"),
    };
    expect(Object.values(originalThemeValues).every((value) => value !== undefined)).toBe(true);
  });

  test.afterAll(async () => {
    if (page) {
      await restoreThemeValues(page, originalThemeValues).catch(async () => {
        // Keep the evidence file even when restoration fails; the CI DB is
        // disposable, but the local operator still needs the original values.
        writeFileSync(
          path.join(EVIDENCE_DIR, "appearance-admin-restore-failed.json"),
          `${JSON.stringify({ originalThemeValues }, null, 2)}\n`,
        );
      });
    }
    evidence.externalFontRequests = [...new Set(fontRequests)].filter(isExternalAdminFont);
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close();
    deleteSuperAdmin(superAdmin.email);
  });

  test("saves Web defaults without breaking the Admin shell", async () => {
    await page.goto(`${ADMIN_URL}/admin/settings?tab=theme`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "外观与字体", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("radiogroup", { name: "默认外观" }).locator('[role="radio"]'),
    ).toHaveCount(3);
    await expect(
      page.getByRole("radiogroup", { name: "默认主题" }).locator('[role="radio"]'),
    ).toHaveCount(SKINS.length);
    await expect(
      page.getByRole("radiogroup", { name: "默认字体" }).locator('[role="radio"]'),
    ).toHaveCount(FONT_PAIRINGS.length);
    await expect(page.getByRole("switch", { name: "允许用户覆盖外观" })).toBeVisible();

    evidence.shellBefore = await page.locator("html").evaluate((element) => ({
      mode: element.getAttribute("data-mode") ?? "",
      theme: element.getAttribute("data-theme") ?? "",
      skin: element.getAttribute("data-skin") ?? "",
      font: element.getAttribute("data-font") ?? "",
      colorScheme: getComputedStyle(element).colorScheme,
    }));
    await chooseRadio(page, "默认外观", "浅色");
    await chooseRadio(page, "默认主题", "Fluent 2");
    await chooseRadio(page, "默认字体", "Primer 中文");

    await page.getByRole("button", { name: "保存外观", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "外观默认值已保存" })).toBeVisible({
      timeout: 30_000,
    });

    const saved = await readSettings(page);
    const savedItems = themeItems(saved);
    evidence.savedDefaults = {
      mode: themeValue(savedItems, "theme.defaultMode"),
      skin: themeValue(savedItems, "theme.defaultSkin"),
      font: themeValue(savedItems, "theme.defaultFont"),
      allowUserOverride: themeValue(savedItems, "theme.allowUserOverride"),
    };
    expect(evidence.savedDefaults).toMatchObject({
      mode: "light",
      skin: "fluent",
      font: "primer-cjk",
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page
        .getByRole("radiogroup", { name: "默认外观" })
        .locator('[role="radio"]')
        .filter({ hasText: "浅色" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page
        .getByRole("radiogroup", { name: "默认主题" })
        .locator('[role="radio"]')
        .filter({ hasText: "Fluent 2" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page
        .getByRole("radiogroup", { name: "默认字体" })
        .locator('[role="radio"]')
        .filter({ hasText: "Primer 中文" }),
    ).toHaveAttribute("aria-checked", "true");

    evidence.shellAfter = await page.locator("html").evaluate((element) => ({
      mode: element.getAttribute("data-mode") ?? "",
      theme: element.getAttribute("data-theme") ?? "",
      skin: element.getAttribute("data-skin") ?? "",
      font: element.getAttribute("data-font") ?? "",
      colorScheme: getComputedStyle(element).colorScheme,
    }));
    expect(evidence.shellAfter).toEqual(evidence.shellBefore);

    evidence.screenshots.push(await shot(page, "admin-appearance-defaults-1440.png"));
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, "admin appearance 390");
    evidence.screenshots.push(await shot(page, "admin-appearance-defaults-390.png"));
  });

  test("quick appearance switcher changes the Admin shell and survives reload", async () => {
    await page.goto(`${ADMIN_URL}/admin`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("navigation", { name: "管理后台主导航" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("quick-appearance-trigger").click();
    await expect(page.getByTestId("quick-appearance-menu")).toBeVisible();
    await page.getByRole("radio", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");

    await page.getByRole("radio", { name: /Porcelain 原生瓷白/u }).click();
    await expect(page.locator("html")).toHaveAttribute("data-skin", "porcelain");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "porcelain");
  });
});
