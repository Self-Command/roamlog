/**
 * PLACES_PELIAS_PORT — real-browser acceptance for the destination combobox.
 *
 * Real stack: Next.js web (:3000) + NestJS API (:4000) + PostgreSQL + a real
 * Better Auth session. No API mocking on the happy path; only the explicit
 * error-state test intercepts `/v1/places/search` to prove the UI's 5xx copy.
 *
 * Run:
 *   npx playwright test --project=web e2e/web/places-search.spec.ts
 *
 * Screenshots:
 *   .audit/places-ui/desktop-<slug>.png  (1440×1000)
 *   .audit/places-ui/mobile-<slug>.png   (390×844)
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, VIEWER_ACCOUNT, type SmokeAccount } from "../support/accounts";

const SHOT_DIR = resolve(process.cwd(), ".audit/places-ui");

// The local Windows runner intermittently loses the trace file while closing
// the browser context; this journey's evidence is screenshots + live API JSON.
test.use({ trace: "off" });

/**
 * The seed account's display name changed after `OWNER_ACCOUNT.name` was
 * written ("Verify Owner" today), so this journey authenticates through the
 * real login form and only relies on reaching `/w/`.
 */
async function login(page: Page, account: SmokeAccount = OWNER_ACCOUNT): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

interface PlaceBody {
  items: Array<{
    name: string;
    address: string | null;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  }>;
  provider: string;
  degraded: boolean;
}

interface QueryExpectation {
  readonly slug: string;
  readonly query: string;
  /** Substrings accepted for the first option's name. */
  readonly name: readonly string[];
  readonly countryCode: string;
  /** Region/country text that must appear in the first option's description. */
  readonly region: readonly string[];
}

const QUERIES: readonly QueryExpectation[] = [
  { slug: "beijing", query: "北京", name: ["北京"], countryCode: "CN", region: ["中国", "北京市"] },
  { slug: "tokyo", query: "东京", name: ["东京", "東京"], countryCode: "JP", region: ["日本"] },
  { slug: "kyoto", query: "京都", name: ["京都"], countryCode: "JP", region: ["日本"] },
  { slug: "paris", query: "Paris", name: ["巴黎", "Paris"], countryCode: "FR", region: ["法国", "France"] },
];

async function workspaceSlug(page: Page): Promise<string> {
  const response = await page.request.get(`${API_URL}/v1/me/workspaces`);
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as Array<{ slug: string }>;
  const wanted = process.env.E2E_PLACES_WORKSPACE_SLUG ?? "roamlog-crew";
  return workspaces.some((workspace) => workspace.slug === wanted)
    ? wanted
    : (workspaces[0]?.slug ?? wanted);
}

async function openDestinationField(page: Page): Promise<Locator> {
  await page.goto("/");
  const slug = await workspaceSlug(page);
  await page.goto(`/w/${slug}/trips/new`);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });
  const input = page.getByRole("combobox", { name: "搜索目的地" });
  await expect(input).toBeVisible();
  await input.scrollIntoViewIfNeeded();
  return input;
}

async function assertQuery(
  page: Page,
  input: Locator,
  expectation: QueryExpectation,
  viewport: "desktop" | "mobile",
): Promise<PlaceBody> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/v1/places/search") &&
      response.request().method() === "GET" &&
      decodeURIComponent(response.url()).includes(`q=${expectation.query}`),
    { timeout: 60_000 },
  );

  await input.fill(expectation.query);
  if (expectation.slug === "kyoto") {
    // Geoapify's Chinese lookup takes ~2.8 s; the combobox must show its
    // loading status instead of looking frozen.
    const loading = page
      .getByRole("listbox", { name: "搜索目的地建议" })
      .getByRole("status");
    await expect(loading).toContainText("正在搜索…", { timeout: 5_000 });
    await page.screenshot({
      path: resolve(SHOT_DIR, `${viewport}-kyoto-loading.png`),
      fullPage: false,
    });
  }
  const response = await responsePromise;
  expect(response.status(), `places search HTTP ${response.status()}`).toBe(200);
  const body = (await response.json()) as PlaceBody;

  expect(body.items.length, `${expectation.query} must return at least one place`).toBeGreaterThan(0);
  expect(body.degraded, `${expectation.query} must not be degraded`).toBe(false);

  const listbox = page.getByRole("listbox", { name: "搜索目的地建议" });
  const first = listbox.getByRole("option").first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const text = await first.innerText();

  expect(
    expectation.name.some((candidate) => text.includes(candidate)),
    `${expectation.query} first option was "${text}"`,
  ).toBe(true);
  expect(text).toContain(expectation.countryCode);
  expect(
    expectation.region.some((candidate) => text.includes(candidate)),
    `${expectation.query} first option region was "${text}"`,
  ).toBe(true);

  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: resolve(SHOT_DIR, `${viewport}-${expectation.slug}.png`),
    fullPage: false,
  });
  return body;
}

test.describe("PLACES_PELIAS_PORT — destination search in the real UI", () => {
  test("desktop 1440 + mobile 390: 北京 / 东京 / 京都 / Paris all resolve to the right region", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await mkdir(SHOT_DIR, { recursive: true });
    await login(page);

    await page.setViewportSize({ width: 1440, height: 1000 });
    let input = await openDestinationField(page);
    for (const expectation of QUERIES) {
      await assertQuery(page, input, expectation, "desktop");
      await input.fill("");
    }

    await page.setViewportSize({ width: 390, height: 844 });
    input = await openDestinationField(page);
    for (const expectation of QUERIES) {
      await assertQuery(page, input, expectation, "mobile");
      await input.fill("");
    }
  });

  test("empty state stays actionable and offers manual entry", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const input = await openDestinationField(page);
    await input.fill("zzzzzzzz");
    const listbox = page.getByRole("listbox", { name: "搜索目的地建议" });
    const options = listbox.getByRole("option");
    await expect(options).toHaveCount(1, { timeout: 30_000 });
    await expect(options.first()).toContainText("手动添加");
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-empty-state.png"),
      fullPage: false,
    });
  });

  test("error state shows a human-readable message and keeps manual entry", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const input = await openDestinationField(page);
    await page.route("**/v1/places/search**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ status: 500, code: "UPSTREAM_ERROR" }),
      }),
    );
    await input.fill("京都");
    const listbox = page.getByRole("listbox", { name: "搜索目的地建议" });
    await expect(listbox.getByRole("status")).toContainText("地点搜索暂时不可用", {
      timeout: 30_000,
    });
    await expect(listbox.getByRole("option", { name: /手动添加/ })).toBeVisible();
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-error-state.png"),
      fullPage: false,
    });
  });

  test("viewer cannot open the new-trip destination form", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, VIEWER_ACCOUNT);
    const slug = await workspaceSlug(page);
    await page.goto(`/w/${slug}/trips/new`);
    await page.waitForLoadState("networkidle").catch(() => {});

    // A viewer is read-only: the create form (and therefore the destination
    // search) must never be usable. The app may redirect or render a denial.
    await expect(page.getByRole("heading", { name: "新建旅行" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "搜索目的地" })).toHaveCount(0);
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-viewer-denied.png"),
      fullPage: false,
    });
  });
});
