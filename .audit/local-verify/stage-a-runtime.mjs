/**
 * Stage A runtime acceptance (local hot-reload stack, no Docker).
 * Verifies the five Review-Focus items from the plan.
 */
import { chromium } from "@playwright/test";

const WEB = "http://localhost:3000";
const ADMIN = "http://localhost:3001";
const SLUG = "verify-crew";
const EMAIL = "verify@roamlog.test";
const PASSWORD = "Roamlog-Verify-Aa1!";

const shots = ".audit/evidence/stage-a/shots";
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const errors = [];

async function newPage(ctx, tag) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${tag}] console: ${m.text().slice(0, 160)}`);
  });
  return page;
}

// 1. Unauthenticated deep link must land on login, not a blank page.
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx, "anon-deeplink");
  await page.goto(`${WEB}/w/${SLUG}/trips/new`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const url = page.url();
  const text = await page.locator("body").innerText().catch(() => "");
  const redirected = /\/login/.test(url) || /登录/.test(text);
  record("unauthenticated deep link redirects to login", redirected, `url=${url.slice(0, 60)}`);
  await page.screenshot({ path: `${shots}/anon-deeplink.png` }).catch(() => {});
  await ctx.close();
}

// 2. Sign in, then every core route renders real content (no demo banner, no blank).
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx, "authed");
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("登录")').first().click();
  await page.waitForTimeout(5000);
  record("sign in reaches a workspace route", /\/w\//.test(page.url()), `url=${page.url().slice(0, 70)}`);

  const routes = ["", "/trips", "/trips/new", "/insights", "/map", "/settings", "/journal", "/members"];
  for (const route of routes) {
    const path = `${WEB}/w/${SLUG}${route}`;
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText().catch(() => "");
    const hasDemo = /本地演示数据|live api|MSW|local fixture|fixture/i.test(body);
    const blank = body.trim().length < 40;
    const name = `route ${route || "/"} renders real content`;
    record(name, !hasDemo && !blank, `len=${body.trim().length} demo=${hasDemo}`);
    await page.screenshot({ path: `${shots}/route${route.replace(/\//g, "-") || "-root"}.png` }).catch(() => {});
  }

  // 3. Empty states and developer copy. A workspace may already hold data, so
  // each route must render either its real empty state or real content — never
  // a blank page and never developer copy (case-insensitive: some labels are
  // uppercased by CSS only).
  const expects = [
    ["", /还没有旅行|总览暂时不可用|趟旅行/],
    ["/insights", /还没有足够的旅行数据|洞察暂时不可用|趟旅行|国家/],
    ["/map", /还没有旅行足迹|还没有可显示的地图坐标|旅行地图暂时不可用|停靠|坐标/],
    ["/trips", /旅行库还是空的|没有匹配的旅行|旅行库暂时不可用|趟旅行|旅行/],
  ];
  const DEV_COPY = /live api|msw|local fixture|本地演示数据|admin api error|data mode/i;
  for (const [route, re] of expects) {
    await page.goto(`${WEB}/w/${SLUG}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText().catch(() => "");
    const rendered = re.test(body) && body.trim().length > 40;
    record(`content or empty state on ${route || "/"}`, rendered, `len=${body.trim().length}`);
    record(`no developer copy on ${route || "/"}`, !DEV_COPY.test(body));
  }

  // 4. Session survives a refresh.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  record("session survives refresh", !/\/login/.test(page.url()), `url=${page.url().slice(0, 70)}`);
  await ctx.close();
}

// 5. Admin without a session must land on the admin login.
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx, "admin-anon");
  await page.goto(`${ADMIN}/admin/users`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const url = page.url();
  const body = await page.locator("body").innerText().catch(() => "");
  record("admin without session redirects to login", /\/login/.test(url) || /登录/.test(body), `url=${url.slice(0, 60)}`);
  await page.screenshot({ path: `${shots}/admin-anon.png` }).catch(() => {});
  await ctx.close();
}

// 6. Admin login page shows no developer copy.
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx, "admin-login");
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText().catch(() => "");
  record("admin login has no developer copy", !/LIVE API|演示预览|ADMIN API ERROR|fixture/i.test(body));
  await page.screenshot({ path: `${shots}/admin-login.png` }).catch(() => {});
  await ctx.close();
}

await browser.close();

console.log("\n=== runtime console errors (first 12) ===");
for (const e of errors.slice(0, 12)) console.log("  " + e);
if (errors.length === 0) console.log("  (none)");

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.name} — ${f.detail}`);
  process.exit(1);
}