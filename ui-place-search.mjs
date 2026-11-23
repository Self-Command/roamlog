/**
 * Drive the real web UI and try a place search, capturing what the user sees.
 *
 * Usage: node .audit/tools/ui-place-search.mjs "北京"
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const query = process.argv[2] ?? "北京";
const outDir = ".audit/ui-place";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
const page = await context.newPage();

const steps = [];
async function shot(name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  steps.push({ name, url: page.url() });
}

try {
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded", timeout: 60000 });
  await shot("01-login");

  const email = page.locator('input[type="email"], input[name="email"]').first();
  const password = page.locator('input[type="password"], input[name="password"]').first();
  await email.fill("verify@roamlog.test");
  await password.fill("Roamlog-Verify-Aa1!");
  await shot("02-filled");

  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  await shot("03-after-login");

  // Go to the trip form, where the destination place search lives.
  await page.goto("http://localhost:3000/w/roamlog-crew/trips/new", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  await shot("04-trip-form");

  const searchInput = page
    .locator('input[placeholder*="搜索"], input[placeholder*="地点"], input[placeholder*="城市"], input[type="search"]')
    .first();
  const hasSearch = (await searchInput.count()) > 0;
  steps.push({ searchInputFound: hasSearch });

  if (hasSearch) {
    await searchInput.click();
    await searchInput.fill(query);
    await page.waitForTimeout(6000);
    await shot("05-search-results");

    const bodyText = await page.locator("body").innerText();
    steps.push({ containsBeijing: /北京/.test(bodyText), bodySnippet: bodyText.slice(0, 600) });
  }
} catch (error) {
  steps.push({ error: String(error).slice(0, 400) });
  await shot("99-error").catch(() => undefined);
}

console.log(JSON.stringify({ query, steps }, null, 2));
await browser.close();
