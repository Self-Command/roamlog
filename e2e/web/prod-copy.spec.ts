/**
 * PROD_COPY_SWEEP — production-copy guard.
 *
 * Runs against the real local stack (web :3000 + API :4000 + Postgres + S3) with
 * a real Better Auth session. Every visited surface is scanned for copy that
 * describes the implementation ("presign", "签名 URL", "真实 API", …) or admits
 * the feature is not finished ("尚未接入", "开发中", "当前仅"). A visible hit
 * fails the test, so the sweep cannot silently regress.
 *
 * Usage:
 *   node node_modules/@playwright/test/cli.js test e2e/web/prod-copy.spec.ts --project=web --reporter=list
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, WEB_URL } from "../support/accounts";

// Parallel agents wipe `test-results/` while suites run; trace/video recording
// then fails at context teardown even though every assertion passed. This spec
// keeps its evidence in `.audit/prod-copy/` instead.
test.use({ trace: "off", video: "off" });

const WORKSPACE_SLUG = "roamlog-crew";

/**
 * Terms that only exist while the product talks about itself instead of doing
 * the work. Matched case-insensitively against visible text plus the attributes
 * users can actually perceive (aria-label / placeholder / title / alt).
 */
const FORBIDDEN_COPY = [
  "presign",
  "签名",
  "真实 API",
  "真实数据",
  "真实坐标",
  "真实",
  "不伪造",
  "MSW",
  "尚未接入",
  "开发中",
  "当前仅",
];

const OUTPUT_DIR = path.join(process.cwd(), ".audit", "prod-copy");

interface RouteCheck {
  /** Screenshot + report name. */
  name: string;
  path: string;
  /** Page heading; also proves the route rendered real content instead of a 404. */
  heading: string;
}

const ROUTES: RouteCheck[] = [
  { name: "01-workspace", path: "", heading: "旅行总览" },
  { name: "02-trips", path: "/trips", heading: "旅行库" },
  { name: "03-journal", path: "/journal", heading: "全部日志" },
  { name: "04-map", path: "/map", heading: "世界足迹" },
  { name: "05-insights", path: "/insights", heading: "旅行洞察" },
  { name: "06-settings", path: "/settings", heading: "设置" },
  { name: "07-activity", path: "/activity", heading: "活动流" },
  { name: "08-notifications", path: "/notifications", heading: "通知中心" },
];

interface ScanResult {
  name: string;
  path: string;
  hits: string[];
  screenshot: string;
}

function screenshotPath(name: string): string {
  return path.join(OUTPUT_DIR, `${name}.png`);
}

async function login(page: Page): Promise<void> {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
  await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 45_000 });
}

interface WorkspaceSummary {
  id: string;
  slug: string;
}

async function resolveWorkspace(page: Page): Promise<WorkspaceSummary> {
  const response = await page.request.get(`${API_URL}/v1/me/workspaces`);
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as WorkspaceSummary[];
  const workspace =
    workspaces.find((entry) => entry.slug === WORKSPACE_SLUG) ?? workspaces.at(0);
  expect(workspace, "the signed-in account must see at least one workspace").toBeTruthy();
  return workspace as WorkspaceSummary;
}

async function resolveTrip(page: Page, workspaceId: string): Promise<{ id: string; title: string }> {
  const response = await page.request.get(
    `${API_URL}/v1/workspaces/${workspaceId}/trips?limit=5`,
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { items: Array<{ id: string; title: string }> };
  const trip = body.items[0];
  expect(trip, `workspace ${workspaceId} must contain a real trip`).toBeTruthy();
  return trip as { id: string; title: string };
}

/** Visible text plus the text-bearing attributes a user can perceive. */
async function readableCopy(page: Page): Promise<string> {
  const text = await page.locator("body").innerText();
  const attributes = await page.evaluate(() => {
    const values: string[] = [];
    const holders = Array.from(
      document.querySelectorAll("[aria-label], [placeholder], [title], [alt]"),
    );
    for (const holder of holders) {
      for (const attribute of ["aria-label", "placeholder", "title", "alt"]) {
        const value = holder.getAttribute(attribute);
        if (value) values.push(value);
      }
    }
    return values.join("\n");
  });
  return `${text}\n${attributes}`;
}

function forbiddenHits(copy: string): string[] {
  const haystack = copy.toLowerCase();
  return FORBIDDEN_COPY.filter((term) => haystack.includes(term.toLowerCase()));
}

/** Waits until the data-backed surfaces stop reporting their loading state. */
async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !/读取中|加载中|正在读取/.test(document.body.innerText), null, {
      timeout: 20_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(700);
}

async function capture(page: Page, name: string): Promise<string> {
  await page.screenshot({ path: screenshotPath(name), fullPage: true, animations: "disabled" });
  return path.relative(process.cwd(), screenshotPath(name)).replaceAll("\\", "/");
}

async function visitAndScan(
  page: Page,
  route: RouteCheck,
  results: ScanResult[],
): Promise<void> {
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}${route.path}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: route.heading }).first(),
    `${route.path} must render ${route.heading}`,
  ).toBeVisible({ timeout: 30_000 });
  await settle(page);

  const copy = await readableCopy(page);
  const hits = forbiddenHits(copy);
  const screenshot = await capture(page, route.name);
  results.push({ name: route.name, path: route.path, hits, screenshot });

  expect(
    hits,
    `route /w/${WORKSPACE_SLUG}${route.path} exposes non-production copy: ${hits.join(", ")}`,
  ).toEqual([]);
  expect(copy.length, `route ${route.path} must render real content`).toBeGreaterThan(400);
}

test("workspace surfaces expose no implementation or unfinished copy", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  await login(page);
  const workspace = await resolveWorkspace(page);
  const trip = await resolveTrip(page, workspace.id);

  const results: ScanResult[] = [];

  for (const route of ROUTES) {
    await visitAndScan(page, route, results);
  }

  // Trip detail: the workspace header cover block and the photo tab are the two
  // places the sweep removed presign/signed-URL explanations.
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/trips/${trip.id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: trip.title }).first(),
    "trip detail must render the real trip title",
  ).toBeVisible({ timeout: 30_000 });
  await settle(page);

  const tripCopy = await readableCopy(page);
  const tripHits = forbiddenHits(tripCopy);
  results.push({
    name: "09-trip-detail",
    path: `/trips/${trip.id}`,
    hits: tripHits,
    screenshot: await capture(page, "09-trip-detail"),
  });
  expect(tripHits, `trip detail exposes non-production copy: ${tripHits.join(", ")}`).toEqual([]);

  // Trip tabs: the cover block, the photo gallery and the activity feed are the
  // places the sweep removed presign/signed-URL explanations and machine verbs.
  const tripTabs = [
    { tab: "照片", name: "10-trip-photos" },
    { tab: "活动", name: "11-trip-activity" },
  ];
  for (const entry of tripTabs) {
    const tab = page.getByRole("tab", { name: entry.tab });
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click();
    await settle(page);

    const tabCopy = await readableCopy(page);
    const tabHits = forbiddenHits(tabCopy);
    results.push({
      name: entry.name,
      path: `/trips/${trip.id} · ${entry.tab}`,
      hits: tabHits,
      screenshot: await capture(page, entry.name),
    });
    expect(
      tabHits,
      `${entry.tab} tab exposes non-production copy: ${tabHits.join(", ")}`,
    ).toEqual([]);
  }

  console.log(
    [
      "",
      "PROD_COPY_SWEEP — scanned surfaces",
      ...results.map(
        (result) =>
          `${result.hits.length === 0 ? "PASS" : "FAIL"} ${result.path} · hits=[${result.hits.join(", ")}] · ${result.screenshot}`,
      ),
      `forbidden terms: ${FORBIDDEN_COPY.join(" | ")}`,
      "",
    ].join("\n"),
  );

  expect(results.length, "at least the eight workspace routes must be scanned").toBeGreaterThanOrEqual(
    8,
  );
});