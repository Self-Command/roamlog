/**
 * Real-stack appearance acceptance.
 *
 * The suite uses the seeded owner account, Next.js SSR, Better Auth, the API
 * and PostgreSQL. It never injects a fake session. The JS-disabled guest
 * context is intentional: it proves that the server emits the appearance
 * attributes before hydration, which is the no-flash contract.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { findWorkspace, loginOnWeb, OWNER_ACCOUNT, WEB_URL } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const SHARE_TOKEN = "roamlog-demo-share-2026-kyoto-trip";
const EVIDENCE_DIR = path.join(process.cwd(), ".audit", "theme-font");
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, "appearance-e2e.json");

const MODES = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
] as const;

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

interface FontResource {
  name: string;
  initiatorType: string;
  transferSize: number;
  encodedBodySize: number;
}

interface AppearancePayload {
  mode: string;
  skin: string;
  fontPairing: string;
  source: string;
  canOverride: boolean;
  defaults: {
    mode: string;
    skin: string;
    fontPairing: string;
  };
}

interface Evidence {
  generatedAt: string;
  workspace: string;
  systemMode: Record<string, string>;
  explicitModes: Record<string, string>;
  skins: Array<{ skin: string; mode: string; background: string; screenshot: string }>;
  fonts: Array<{ fontPairing: string; screenshot: string }>;
  initialFontResources: FontResource[];
  initialLatinFontBytes: number;
  initialChinesePageFontBytes: number;
  externalFontRequests: string[];
  persistence: Record<string, unknown> | null;
  guest: Record<string, unknown> | null;
  reset: AppearancePayload | null;
}

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  workspace: "",
  systemMode: {},
  explicitModes: {},
  skins: [],
  fonts: [],
  initialFontResources: [],
  initialLatinFontBytes: 0,
  initialChinesePageFontBytes: 0,
  externalFontRequests: [],
  persistence: null,
  guest: null,
  reset: null,
};

mkdirSync(EVIDENCE_DIR, { recursive: true });

let context: BrowserContext;
let page: Page;
let workspaceSlug = "";
const fontRequests: string[] = [];

test.describe.configure({ mode: "serial", timeout: 300_000 });

async function shot(pageToCapture: Page, name: string, fullPage = true): Promise<string> {
  const target = path.join(EVIDENCE_DIR, name);
  await pageToCapture.evaluate(async () => {
    await document.fonts.ready;
  });
  await pageToCapture.screenshot({
    path: target,
    fullPage,
    animations: "disabled",
  });
  return path.relative(process.cwd(), target).split(path.sep).join("/");
}

async function chooseRadio(pageToUse: Page, groupName: string, label: string): Promise<void> {
  const group = pageToUse.getByRole("radiogroup", { name: groupName });
  const option = group.locator('[role="radio"]').filter({ hasText: label });
  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");
}

async function backgroundOf(pageToUse: Page): Promise<string> {
  return pageToUse.evaluate(() => {
    for (const node of [document.body, document.querySelector("main"), document.documentElement]) {
      if (!(node instanceof HTMLElement)) continue;
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
        return color;
      }
    }
    return "";
  });
}

async function readFontResources(pageToUse: Page): Promise<FontResource[]> {
  await pageToUse.evaluate(async () => {
    await document.fonts.ready;
  });
  return pageToUse.evaluate(() => {
    return performance
      .getEntriesByType("resource")
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => /\.woff2(?:\?|$)/iu.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
      }));
  });
}

function fontBytes(resources: readonly FontResource[]): number {
  return resources.reduce(
    (total, resource) => total + (resource.encodedBodySize || resource.transferSize),
    0,
  );
}

function isExternalFont(url: string): boolean {
  if (/fonts\.(?:googleapis|gstatic)\.com/iu.test(url)) return true;
  try {
    return new URL(url).origin !== new URL(WEB_URL).origin;
  } catch {
    return true;
  }
}

async function deleteUserAppearance(pageToUse: Page): Promise<void> {
  const response = await pageToUse.request.delete(`${WEB_URL}/v1/me/appearance`);
  expect([200, 204]).toContain(response.status());
}

async function readUserAppearance(pageToUse: Page): Promise<AppearancePayload> {
  const response = await pageToUse.request.get(`${WEB_URL}/v1/me/appearance`);
  expect(response.status()).toBe(200);
  return (await response.json()) as AppearancePayload;
}

test.describe("user appearance and public share", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on("request", (request) => {
      if (request.resourceType() === "font") {
        fontRequests.push(request.url());
      }
    });

    await loginOnWeb(page, OWNER_ACCOUNT);
    const workspace = await findWorkspace(page.request);
    workspaceSlug = workspace.slug;
    evidence.workspace = workspaceSlug;
    await deleteUserAppearance(page);
  });

  test.afterAll(async () => {
    if (page) {
      await deleteUserAppearance(page).catch(() => undefined);
    }
    evidence.externalFontRequests = [...new Set(fontRequests)].filter(isExternalFont);
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close();
  });

  test("eight enterprise themes and four local font pairings persist without flash", async () => {
    await page.goto(`${WEB_URL}/w/${workspaceSlug}/settings/appearance`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "外观", exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await expect(
      page.getByRole("radiogroup", { name: "显示模式" }).locator('[role="radio"]'),
    ).toHaveCount(MODES.length);
    await expect(
      page.getByRole("radiogroup", { name: "主题" }).locator('[role="radio"]'),
    ).toHaveCount(SKINS.length);
    await expect(
      page.getByRole("radiogroup", { name: "字体配对" }).locator('[role="radio"]'),
    ).toHaveCount(FONT_PAIRINGS.length);

    const initialFonts = await readFontResources(page);
    evidence.initialFontResources = initialFonts;
    expect(initialFonts.length).toBeGreaterThan(0);
    const latinFonts = initialFonts.filter(
      (resource) => !/noto-(?:sans|serif)-sc/iu.test(resource.name),
    );
    evidence.initialLatinFontBytes = fontBytes(latinFonts);
    evidence.initialChinesePageFontBytes = fontBytes(initialFonts);
    expect(fontBytes(latinFonts)).toBeLessThanOrEqual(400 * 1024);
    expect(fontBytes(initialFonts)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(initialFonts.filter((resource) => isExternalFont(resource.name))).toEqual([]);

    await page.emulateMedia({ colorScheme: "light" });
    await chooseRadio(page, "显示模式", "跟随系统");
    await page.waitForTimeout(150);
    const systemLight = await backgroundOf(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    const systemDark = await backgroundOf(page);
    expect(systemLight).not.toBe(systemDark);
    evidence.systemMode = { light: systemLight, dark: systemDark };
    await page.emulateMedia({ colorScheme: null });

    await chooseRadio(page, "显示模式", "浅色");
    await page.waitForTimeout(100);
    const explicitLight = await backgroundOf(page);
    await chooseRadio(page, "显示模式", "深色");
    await page.waitForTimeout(100);
    const explicitDark = await backgroundOf(page);
    expect(explicitLight).not.toBe(explicitDark);
    evidence.explicitModes = { light: explicitLight, dark: explicitDark };

    for (const mode of [
      { id: "light", label: "浅色" },
      { id: "dark", label: "深色" },
    ] as const) {
      await chooseRadio(page, "显示模式", mode.label);
      for (const skin of SKINS) {
        await chooseRadio(page, "主题", skin.label);
        await expect(page.locator("html")).toHaveAttribute("data-skin", skin.id);
        await page.waitForTimeout(80);
        const background = await backgroundOf(page);
        const screenshot = await shot(page, `web-appearance-${skin.id}-${mode.id}-1440.png`);
        evidence.skins.push({
          skin: skin.id,
          mode: mode.id,
          background,
          screenshot,
        });
      }
    }

    for (const font of FONT_PAIRINGS) {
      await chooseRadio(page, "字体配对", font.label);
      await expect(page.locator("html")).toHaveAttribute("data-font", font.id);
      const screenshot = await shot(page, `web-appearance-font-${font.id}-1440.png`);
      evidence.fonts.push({ fontPairing: font.id, screenshot });
    }

    await chooseRadio(page, "显示模式", "浅色");
    await chooseRadio(page, "主题", "Porcelain 原生瓷白");
    await chooseRadio(page, "字体配对", "Fluent 原生");
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "porcelain");
    await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");
    await page.getByRole("button", { name: "保存外观", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "外观设置已保存" })).toBeVisible({
      timeout: 30_000,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "porcelain");
    await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");
    const saved = await readUserAppearance(page);
    expect(saved).toMatchObject({
      mode: "light",
      skin: "porcelain",
      fontPairing: "fluent-native",
      source: "user",
    });
    evidence.persistence = {
      ...saved,
      screenshot: await shot(page, "web-appearance-saved-1440.png"),
    };

    await context.addCookies([
      {
        name: "roamlog_appearance",
        value: encodeURIComponent(
          JSON.stringify({
            v: 1,
            mode: "dark",
            skin: "rose-pine",
            fontPairing: "swiss-modern",
            uid: "019a0000-0000-7000-8000-000000000001",
            updatedAt: new Date().toISOString(),
          }),
        ),
        domain: new URL(WEB_URL).hostname,
        path: "/",
        httpOnly: false,
        sameSite: "Lax",
      },
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    await expect(page.locator("html")).toHaveAttribute("data-skin", "porcelain");
    await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page, "appearance settings 390");
    await shot(page, "web-appearance-mobile-390.png");

    await page.getByRole("button", { name: "恢复平台默认", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "已恢复平台默认外观" })).toBeVisible({
      timeout: 30_000,
    });
    const reset = await readUserAppearance(page);
    expect(reset.source).not.toBe("user");
    await expect(page.locator("html")).toHaveAttribute("data-mode", reset.mode);
    await expect(page.locator("html")).toHaveAttribute("data-skin", reset.skin);
    await expect(page.locator("html")).toHaveAttribute("data-font", reset.fontPairing);
    evidence.reset = reset;
  });

  test("guest cookie reaches first paint and public share without JS", async ({ browser }) => {
    const guestContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 1000 },
    });
    const guestFontRequests: string[] = [];
    try {
      await guestContext.addCookies([
        {
          name: "roamlog_appearance",
          value: encodeURIComponent(
            JSON.stringify({
              v: 1,
              mode: "dark",
              skin: "rose-pine",
              fontPairing: "cjk-editorial",
            }),
          ),
          domain: new URL(WEB_URL).hostname,
          path: "/",
          httpOnly: false,
          sameSite: "Lax",
        },
      ]);
      const guestPage = await guestContext.newPage();
      guestPage.on("request", (request) => {
        if (request.resourceType() === "font") {
          guestFontRequests.push(request.url());
        }
      });

      const loginResponse = await guestPage.goto(`${WEB_URL}/login`, {
        waitUntil: "domcontentloaded",
      });
      expect(loginResponse?.status()).toBe(200);
      await expect(guestPage.locator("html")).toHaveAttribute("data-mode", "dark");
      await expect(guestPage.locator("html")).toHaveAttribute("data-skin", "fluent");
      await expect(guestPage.locator("html")).toHaveAttribute("data-font", "fluent-native");
      await shot(guestPage, "guest-cookie-login-1440.png");

      const shareResponse = await guestPage.goto(`${WEB_URL}/share/${SHARE_TOKEN}`, {
        waitUntil: "domcontentloaded",
      });
      expect(shareResponse?.status()).toBe(200);
      await expect(guestPage.locator("html")).toHaveAttribute("data-mode", "dark");
      await expect(guestPage.locator("html")).toHaveAttribute("data-skin", "fluent");
      await expect(guestPage.locator("html")).toHaveAttribute("data-font", "fluent-native");
      await shot(guestPage, "guest-cookie-share-1440.png");

      await guestPage.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(guestPage, "guest cookie share 390");
      await shot(guestPage, "guest-cookie-share-390.png");

      const external = [...new Set(guestFontRequests)].filter(isExternalFont);
      expect(external).toEqual([]);
      evidence.guest = {
        loginStatus: loginResponse?.status(),
        shareStatus: shareResponse?.status(),
        mode: "dark",
        skin: "fluent",
        fontPairing: "fluent-native",
        externalFontRequests: external,
      };
    } finally {
      await guestContext.close();
    }
  });
});
