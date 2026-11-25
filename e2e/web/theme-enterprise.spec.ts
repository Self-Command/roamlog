/**
 * Enterprise theme foundation acceptance.
 *
 * This suite intentionally uses the real built Web app, SSR and the public
 * guest cookie. It does not need a signed-in account: appearance is part of
 * the first paint and is also valid on `/login`.
 */
import { expect, test, type BrowserContext } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { WEB_URL } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const OUT_DIR = path.join(process.cwd(), ".audit", "theme-enterprise", "foundation");
const EVIDENCE_FILE = path.join(OUT_DIR, "enterprise-foundation.json");

const THEMES = [
  { skin: "porcelain", font: "fluent-native", label: "porcelain" },
  { skin: "fluent", font: "fluent-native", label: "fluent" },
  { skin: "carbon", font: "carbon-plex", label: "carbon" },
  { skin: "carbon-soft", font: "primer-cjk", label: "carbon-soft" },
] as const;

interface Evidence {
  generatedAt: string;
  defaultAttributes: Record<string, string>;
  legacyAttributes: Record<string, string>;
  themes: Array<{
    skin: string;
    font: string;
    background: string;
    bodyFont: string;
    screenshot: string;
  }>;
  narrow: { screenshot: string; overflow: number } | null;
  externalFontRequests: string[];
}

const evidence: Evidence = {
  generatedAt: new Date().toISOString(),
  defaultAttributes: {},
  legacyAttributes: {},
  themes: [],
  narrow: null,
  externalFontRequests: [],
};

mkdirSync(OUT_DIR, { recursive: true });

function cookieValue(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

async function shot(context: BrowserContext, name: string, width: number, height: number) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const target = path.join(OUT_DIR, name);
  await page.screenshot({ path: target, fullPage: true, animations: "disabled" });
  const result = {
    screenshot: path.relative(process.cwd(), target).split(path.sep).join("/"),
    background: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    bodyFont: await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  };
  await page.close();
  return result;
}

test.describe("enterprise theme foundation", () => {
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test.afterAll(() => {
    writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  test("defaults to Porcelain + native sans before hydration", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") requests.push(request.url());
    });
    try {
      await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
      await expect(page.locator("html")).toHaveAttribute("data-skin", "porcelain");
      await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");
      evidence.defaultAttributes = await page.locator("html").evaluate((node) => ({
        mode: node.getAttribute("data-mode") ?? "",
        skin: node.getAttribute("data-skin") ?? "",
        font: node.getAttribute("data-font") ?? "",
      }));
      evidence.externalFontRequests = requests.filter((url) => {
        try {
          return new URL(url).origin !== new URL(WEB_URL).origin;
        } catch {
          return true;
        }
      });
      expect(evidence.externalFontRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("normalizes a legacy cookie to an enterprise skin before paint", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await context.addCookies([
        {
          name: "roamlog_appearance",
          value: cookieValue({
            v: 1,
            mode: "dark",
            skin: "rose-pine",
            fontPairing: "swiss-modern",
          }),
          domain: new URL(WEB_URL).hostname,
          path: "/",
          httpOnly: false,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
      await expect(page.locator("html")).toHaveAttribute("data-skin", "fluent");
      await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");
      evidence.legacyAttributes = await page.locator("html").evaluate((node) => ({
        mode: node.getAttribute("data-mode") ?? "",
        skin: node.getAttribute("data-skin") ?? "",
        font: node.getAttribute("data-font") ?? "",
      }));
    } finally {
      await context.close();
    }
  });

  test("renders every enterprise theme at 1440 and keeps 390px usable", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      for (const theme of THEMES) {
        await context.addCookies([
          {
            name: "roamlog_appearance",
            value: cookieValue({
              v: 1,
              mode: "light",
              skin: theme.skin,
              fontPairing: theme.font,
            }),
            domain: new URL(WEB_URL).hostname,
            path: "/",
            httpOnly: false,
            sameSite: "Lax",
          },
        ]);
        const result = await shot(
          context,
          `enterprise-${theme.label}-1440.png`,
          1440,
          1000,
        );
        evidence.themes.push({
          skin: theme.skin,
          font: theme.font,
          background: result.background,
          bodyFont: result.bodyFont,
          screenshot: result.screenshot,
        });
      }

      await context.addCookies([
        {
          name: "roamlog_appearance",
          value: cookieValue({
            v: 1,
            mode: "light",
            skin: "fluent",
            fontPairing: "fluent-native",
          }),
          domain: new URL(WEB_URL).hostname,
          path: "/",
          httpOnly: false,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      await expectNoHorizontalOverflow(page, "enterprise login 390");
      const target = path.join(OUT_DIR, "enterprise-fluent-390.png");
      await page.screenshot({ path: target, fullPage: true, animations: "disabled" });
      evidence.narrow = {
        screenshot: path.relative(process.cwd(), target).split(path.sep).join("/"),
        overflow,
      };
      await page.close();
    } finally {
      await context.close();
    }
  });
});
