/**
 * TRIP_MAP_PAGE — real-browser acceptance for the per-trip map page.
 *
 * Covers the whole page, not a component: the Server Component reads the trip
 * and its stops through the same `/v1` contract the rest of the app uses, then
 * MapCanvas draws the markers and the dashed route.
 *
 * Run (npx playwright exits 126 on this machine):
 *   node node_modules/@playwright/test/cli.js test e2e/web/trip-map.spec.ts --project=web --reporter=list
 *
 * Evidence:
 *   .audit/trip-map/desktop-1440.png
 *   .audit/trip-map/mobile-390.png
 *   .audit/trip-map/empty-no-coordinates-1440.png
 *   .audit/trip-map/empty-no-stops-1440.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, signInViaApi } from "../support/accounts";

const WORKSPACE_SLUG = "roamlog-crew";
const TRIP_TITLE = "京都十一月";
const SHOT_DIR = resolve(process.cwd(), ".audit/trip-map");
const WORKER_SHOT_DIR = resolve(process.cwd(), ".audit/maplibre-csp");

// The local Windows runner can lose trace files while closing Chromium; this
// journey's evidence is the screenshots plus the measured canvas boxes/pixels.
test.use({ trace: "off" });

const FORBIDDEN_COPY = /尚未接入|开发中|真实地图|不伪造|占位/u;

/**
 * Real Better Auth sign-in through the web login page. Same flow as
 * e2e/web/map-flat.spec.ts:31-37 (the seed's display name is not stable enough
 * to assert on, so the redirect into `/w/` is the success marker).
 */
async function login(page: Page): Promise<void> {
  await page.goto("/login");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
    await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();

    const landed = await page
      .waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;

    const transient = await page
      .getByText("Authentication response was not JSON.")
      .isVisible()
      .catch(() => false);
    if (!transient || attempt === 3) break;
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  throw new Error(`web login for ${OWNER_ACCOUNT.email} did not reach /w/`);
}

interface TripSummary {
  id: string;
  title: string;
}

interface WorkspaceSummary {
  id: string;
  slug: string;
}

function mapRoot(page: Page): Locator {
  return page.getByTestId("maplibre-canvas");
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="maplibre-canvas"] canvas.maplibregl-canvas');
}

function mapViewport(page: Page): Locator {
  return page.locator('[data-testid="maplibre-canvas"] .maplibregl-map');
}

async function resolveWorkspace(page: Page): Promise<WorkspaceSummary> {
  const response = await page.request.get("/v1/me/workspaces");
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as WorkspaceSummary[];
  const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
  expect(workspace, `workspace ${WORKSPACE_SLUG} must be visible to ${OWNER_ACCOUNT.email}`).toBeTruthy();
  return workspace as WorkspaceSummary;
}

async function listTrips(page: Page, workspaceId: string): Promise<TripSummary[]> {
  return listTripsForRequest(page.request, workspaceId);
}

async function listTripsForRequest(
  request: APIRequestContext,
  workspaceId: string,
): Promise<TripSummary[]> {
  const response = await request.get(`/v1/workspaces/${workspaceId}/trips?limit=100`);
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { items?: TripSummary[] };
  return body.items ?? [];
}

/** Resolves the seeded trip by title so a reseeded database keeps working. */
async function resolveSeededTrip(page: Page, workspaceId: string): Promise<TripSummary> {
  const trip = (await listTrips(page, workspaceId)).find((entry) => entry.title === TRIP_TITLE);
  expect(trip, `seeded trip "${TRIP_TITLE}" must exist in ${WORKSPACE_SLUG}`).toBeTruthy();
  return trip as TripSummary;
}

/**
 * Signs in on a throwaway API request context and returns the seeded trip id.
 * Used by the logged-out journey, whose browser context must stay anonymous.
 */
async function resolveSeededTripViaApi(): Promise<string> {
  const lookup = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    await signInViaApi(lookup, OWNER_ACCOUNT);
    const workspacesResponse = await lookup.get(`${API_URL}/v1/me/workspaces`);
    expect(workspacesResponse.status(), await workspacesResponse.text()).toBe(200);
    const workspaces = (await workspacesResponse.json()) as WorkspaceSummary[];
    const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
    expect(workspace, `workspace ${WORKSPACE_SLUG} must be visible`).toBeTruthy();
    const trip = (await listTripsForRequest(lookup, workspace?.id ?? "")).find(
      (entry) => entry.title === TRIP_TITLE,
    );
    expect(trip, `seeded trip ${TRIP_TITLE} must exist`).toBeTruthy();
    return trip?.id ?? "";
  } finally {
    await lookup.dispose();
  }
}

interface FixtureStop {
  city: string;
  country: string;
  countryCode: string;
  lat?: number | null;
  lng?: number | null;
  startDate: string;
  endDate: string;
  order?: number;
}

/**
 * Creates the empty-state trips through the real API (no DB writes, no mocks).
 * The previous run's fixtures are deleted first, so the shared dev database
 * holds at most one copy of each.
 */
async function ensureFixtureTrip(
  page: Page,
  workspaceId: string,
  title: string,
  stops: FixtureStop[],
): Promise<TripSummary> {
  const existing = (await listTrips(page, workspaceId)).find((entry) => entry.title === title);
  if (existing) {
    const deleted = await page.request.delete(`/v1/trips/${existing.id}`);
    expect([204, 200], `delete stale fixture ${existing.id}`).toContain(deleted.status());
  }

  const created = await page.request.post(`/v1/workspaces/${workspaceId}/trips`, {
    data: { title, startDate: "2026-12-01", endDate: "2026-12-03" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const trip = (await created.json()) as TripSummary;

  for (const stop of stops) {
    const response = await page.request.post(`/v1/trips/${trip.id}/stops`, { data: stop });
    expect(response.status(), await response.text()).toBe(201);
  }

  return trip;
}

interface CanvasStats {
  width: number;
  height: number;
  meanLuminance: number;
  darkRatio: number;
  nonWhiteRatio: number;
  sampledColors: number;
}

/**
 * Decodes the canvas screenshot inside the already-running browser (same
 * approach as e2e/web/map-flat.spec.ts) so the repository gains no PNG
 * dependency for one assertion.
 */
async function canvasStats(page: Page, canvas: Locator): Promise<CanvasStats> {
  const png = await canvas.screenshot({ animations: "disabled" });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const context = surface.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable while sampling the map screenshot");
    context.drawImage(image, 0, 0);

    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const colors = new Set<string>();
    let luminance = 0;
    let dark = 0;
    let nonWhite = 0;
    let samples = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);

    for (let index = 0; index < pixels.length; index += stride) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      luminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (red < 8 && green < 8 && blue < 8) dark += 1;
      if (red < 245 || green < 245 || blue < 245) nonWhite += 1;
      samples += 1;
      if (colors.size < 64) colors.add(`${red},${green},${blue}`);
    }

    return {
      width: image.width,
      height: image.height,
      meanLuminance: samples ? luminance / samples : 0,
      darkRatio: samples ? dark / samples : 1,
      nonWhiteRatio: samples ? nonWhite / samples : 0,
      sampledColors: colors.size,
    };
  }, png.toString("base64"));
}

async function expectRenderedMap(page: Page, label: string): Promise<CanvasStats> {
  await expect(mapRoot(page)).toBeVisible({ timeout: 30_000 });
  await expect(mapCanvas(page)).toHaveCount(1, { timeout: 30_000 });

  const canvasBox = await mapCanvas(page).boundingBox();
  const viewportBox = await mapViewport(page).boundingBox();
  console.log(
    `[trip-map] ${label} canvas=${JSON.stringify(canvasBox)} viewport=${JSON.stringify(viewportBox)}`,
  );

  // The page-level regression was an auto-height frame: MapLibre's own viewport
  // computed to 0 px while the canvas overflowed at its intrinsic size.
  expect(viewportBox, `${label}: MapLibre viewport must have a box`).not.toBeNull();
  expect(viewportBox?.height ?? 0, `${label}: MapLibre viewport height`).toBeGreaterThan(200);
  expect(viewportBox?.width ?? 0, `${label}: MapLibre viewport width`).toBeGreaterThan(200);

  expect(canvasBox, `${label}: canvas must have a box`).not.toBeNull();
  expect(canvasBox?.height ?? 0, `${label}: canvas height`).toBeGreaterThan(200);
  expect(canvasBox?.width ?? 0, `${label}: canvas width`).toBeGreaterThan(200);

  let stats: CanvasStats | null = null;
  await expect
    .poll(
      async () => {
        stats = await canvasStats(page, mapCanvas(page));
        return (
          stats.meanLuminance > 40 &&
          stats.darkRatio < 0.6 &&
          stats.nonWhiteRatio > 0.08 &&
          stats.sampledColors >= 64
        );
      },
      { timeout: 45_000, intervals: [1_000, 1_500, 2_000] },
    )
    .toBe(true);

  expect(stats, `${label}: pixel stats`).not.toBeNull();
  console.log(`[trip-map] ${label} pixels=${JSON.stringify(stats)}`);
  expect(stats?.nonWhiteRatio ?? 0, `${label}: real tile content, not a blank canvas`).toBeGreaterThan(
    0.08,
  );
  expect(stats?.sampledColors ?? 0, `${label}: full-color map tiles`).toBeGreaterThanOrEqual(64);
  return stats as CanvasStats;
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: resolve(SHOT_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
}

/**
 * Tiles arrive after MapLibre's canvas exists, so a canvas-only box check can
 * screen-shot a bare background. Wait until two consecutive canvas frames are
 * byte-identical: at that point the style and its tiles have settled.
 */
async function waitForSettledCanvas(page: Page, timeoutMs = 30_000): Promise<boolean> {
  let previous = Buffer.alloc(0);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = await mapCanvas(page).screenshot({ animations: "disabled" });
    if (frame.equals(previous)) return true;
    previous = frame;
    await page.waitForTimeout(1_000);
  }
  return false;
}

async function expectNoForbiddenCopy(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toContainText(FORBIDDEN_COPY);
}

test.describe("TRIP_MAP_PAGE — 行程地图", () => {
  test("桌面 1440：真实地图、路线、停靠点列表与点选", async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(SHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await login(page);
    const workspace = await resolveWorkspace(page);
    const trip = await resolveSeededTrip(page, workspace.id);

    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${trip.id}/map`);
    await expect(page.getByRole("heading", { name: "行程地图" })).toBeVisible({ timeout: 30_000 });

    // Breadcrumb: 工作区 / 旅行名 / 地图.
    const breadcrumbs = page.getByTestId("trip-map-page").getByRole("navigation", { name: "面包屑" });
    await expect(breadcrumbs).toContainText(TRIP_TITLE);
    await expect(breadcrumbs).toContainText("地图");

    // The map surface must be laid out, painted, and non-black.
    const stats = await expectRenderedMap(page, "desktop-1440");
    expect(stats.height).toBeGreaterThan(200);

    // Both stops from the seeded trip are listed on the page.
    const sidebar = page.getByTestId("trip-map-sidebar");
    await expect(sidebar).toContainText("京都市");
    await expect(sidebar).toContainText("大阪市");

    // Marker -> sidebar selection: click the 大阪市 marker and read the card.
    await page.getByRole("button", { name: "选择停靠点 大阪市" }).click();
    const selectedItem = page.getByRole("button", { name: "定位停靠点 大阪市" });
    await expect(selectedItem).toHaveAttribute("aria-pressed", "true");
    const selectedCard = page.getByTestId("trip-map-selected-stop");
    await expect(selectedCard).toBeVisible();
    await expect(selectedCard).toContainText("大阪市");
    await expect(selectedCard).toContainText("日本");
    expect(await waitForSettledCanvas(page), "desktop: tiles settle before the screenshot").toBe(true);
    await saveScreenshot(page, "desktop-1440.png");

    // Sidebar -> marker selection is the same state read the other way.
    await page.getByRole("button", { name: "定位停靠点 京都市" }).click();
    await expect(page.getByRole("button", { name: "选择停靠点 京都市" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(selectedItem).toHaveAttribute("aria-pressed", "false");

    await expectNoForbiddenCopy(page);

    // A reload keeps the page real (server fetch + tile render), not a cached sketch.
    await page.reload();
    await expect(page.getByTestId("trip-map-sidebar")).toContainText("京都市", { timeout: 30_000 });
    await expectRenderedMap(page, "desktop-1440-reload");
  });

  test("移动端 390：地图定高、侧栏落在下方、无横向溢出", async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(SHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await login(page);
    const workspace = await resolveWorkspace(page);
    const trip = await resolveSeededTrip(page, workspace.id);

    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${trip.id}/map`);
    await expect(page.getByRole("heading", { name: "行程地图" })).toBeVisible({ timeout: 30_000 });
    await expectRenderedMap(page, "mobile-390");

    const mapBox = await mapRoot(page).boundingBox();
    const sidebarBox = await page.getByTestId("trip-map-sidebar").boundingBox();
    expect(mapBox, "mobile: map box").not.toBeNull();
    expect(sidebarBox, "mobile: sidebar box").not.toBeNull();
    expect(mapBox?.height ?? 0, "mobile: 320 px frame").toBeGreaterThan(200);
    expect(sidebarBox?.y ?? 0, "mobile: sidebar stacks below the map").toBeGreaterThanOrEqual(
      (mapBox?.y ?? 0) + (mapBox?.height ?? 0) - 2,
    );

    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(metrics.documentWidth, "mobile: document horizontal overflow").toBeLessThanOrEqual(
      metrics.viewportWidth + 1,
    );
    expect(metrics.bodyWidth, "mobile: body horizontal overflow").toBeLessThanOrEqual(
      metrics.viewportWidth + 1,
    );

    expect(await waitForSettledCanvas(page), "mobile: tiles settle before the screenshot").toBe(true);
    await saveScreenshot(page, "mobile-390.png");
    await expectNoForbiddenCopy(page);
  });

  test("空态：有停靠点但都没有坐标", async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(SHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await login(page);
    const workspace = await resolveWorkspace(page);
    await ensureFixtureTrip(page, workspace.id, "地图空态校验 / 无坐标停靠点", [
      {
        city: "雅典",
        country: "希腊",
        countryCode: "GR",
        lat: null,
        lng: null,
        startDate: "2026-12-01",
        endDate: "2026-12-03",
        order: 0,
      },
    ]);

    // The fixture id is resolved through the list so nothing is hardcoded.
    const fixture = (await listTrips(page, workspace.id)).find(
      (entry) => entry.title === "地图空态校验 / 无坐标停靠点",
    );
    expect(fixture, "no-coordinates fixture trip").toBeTruthy();
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${fixture?.id}/map`);

    await expect(page.getByRole("heading", { name: "停靠点还没有坐标" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("maplibre-canvas")).toHaveCount(0);
    await expect(page.getByTestId("trip-map-sidebar")).toContainText("雅典");
    await expect(page.getByRole("link", { name: "去编辑旅行补充坐标" })).toBeVisible();
    await expect(page.getByRole("link", { name: "去编辑旅行补充坐标" })).toHaveAttribute(
      "href",
      `/w/${WORKSPACE_SLUG}/trips/${fixture?.id}/edit`,
    );

    await saveScreenshot(page, "empty-no-coordinates-1440.png");
    await expectNoForbiddenCopy(page);
  });

  test("空态：这趟旅行还没有停靠点", async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(SHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await login(page);
    const workspace = await resolveWorkspace(page);
    await ensureFixtureTrip(page, workspace.id, "地图空态校验 / 没有停靠点", []);

    const fixture = (await listTrips(page, workspace.id)).find(
      (entry) => entry.title === "地图空态校验 / 没有停靠点",
    );
    expect(fixture, "no-stops fixture trip").toBeTruthy();
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${fixture?.id}/map`);

    await expect(page.getByRole("heading", { name: "这趟旅行还没有停靠点" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("maplibre-canvas")).toHaveCount(0);
    await expect(page.getByTestId("trip-map-sidebar")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "添加停靠点" })).toBeVisible();
    await expect(page.getByRole("link", { name: "添加停靠点" })).toHaveAttribute(
      "href",
      `/w/${WORKSPACE_SLUG}/trips/${fixture?.id}/edit`,
    );

    await saveScreenshot(page, "empty-no-stops-1440.png");
    await expectNoForbiddenCopy(page);
  });

  test("错误态：不存在的旅行 id 显示找不到这趟旅行", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await login(page);
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/019b0000-0000-7000-8000-000000000000/map`);

    await expect(page.getByRole("heading", { name: "找不到这趟旅行" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("maplibre-canvas")).toHaveCount(0);
    await expectNoForbiddenCopy(page);
  });

  test("未登录访问：不泄露停靠点", async ({ page }) => {
    test.setTimeout(180_000);

    // Resolve the seeded trip id on a separate, signed-in request context so the
    // browser context stays logged out for the actual assertion.
    const seededTripId = await resolveSeededTripViaApi();

    const anonymous = await page.request.get("/v1/me/workspaces");
    expect(anonymous.status(), "browser context has no session").toBe(401);

    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${seededTripId}/map`);
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText("京都市");
    await expect(page.locator("body")).not.toContainText("大阪市");
    await expect(page.getByTestId("maplibre-canvas")).toHaveCount(0);
  });

  test("MapLibre worker 本地同源托管，生产 CSP 不拦截", async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(WORKER_SHOT_DIR, { recursive: true });

    const workerUrls: string[] = [];
    const blockedWorkerMessages: string[] = [];
    page.on("worker", (worker) => {
      if (worker.url().includes("maplibre-gl-worker")) workerUrls.push(worker.url());
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("maplibre-gl-worker")) {
        blockedWorkerMessages.push(
          `requestfailed ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
        );
      }
    });
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        /content security policy|worker failed to load|failed to construct 'worker'/iu.test(text)
      ) {
        blockedWorkerMessages.push(text);
      }
    });

    await login(page);
    const workspace = await resolveWorkspace(page);
    const trip = await resolveSeededTrip(page, workspace.id);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${trip.id}/map`);
    await expect(page.getByRole("heading", { name: "行程地图" })).toBeVisible({ timeout: 30_000 });
    await expectRenderedMap(page, "local-worker-1440");

    const workerResponse = await page.request.get(
      new URL("/maplibre-gl-worker.mjs", page.url()).href,
    );
    expect(workerResponse.status(), await workerResponse.text()).toBe(200);
    expect(workerResponse.headers()["content-type"]).toMatch(/javascript/u);

    await expect
      .poll(() => workerUrls.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(
      workerUrls.every((url) => new URL(url).origin === new URL(page.url()).origin),
      `MapLibre workers must be same-origin: ${workerUrls.join(", ")}`,
    ).toBe(true);
    expect(workerUrls.some((url) => new URL(url).pathname === "/maplibre-gl-worker.mjs")).toBe(
      true,
    );
    expect(blockedWorkerMessages, "no CSP or worker construction failures").toEqual([]);

    const documentCsp = (await page.request.get(page.url())).headers()["content-security-policy"];
    if (documentCsp) {
      expect(documentCsp).toMatch(/worker-src 'self' blob:/u);
      expect(documentCsp).not.toMatch(/worker-src[^;]*cdn\.jsdelivr\.net/u);
    }

    const remoteWorkerReferences = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => url.includes("cdn.jsdelivr.net/npm/maplibre-gl")),
    );
    expect(remoteWorkerReferences).toEqual([]);

    await page.screenshot({
      path: resolve(WORKER_SHOT_DIR, "maplibre-local-worker-1440.png"),
      animations: "disabled",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expectRenderedMap(page, "local-worker-390");
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: resolve(WORKER_SHOT_DIR, "maplibre-local-worker-390.png"),
      animations: "disabled",
    });
  });

  test("MapLibre worker 加载失败时立即切换到示意图", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/maplibre-gl-worker.mjs*", (route) => route.abort("blockedbyclient"));

    await login(page);
    const workspace = await resolveWorkspace(page);
    const trip = await resolveSeededTrip(page, workspace.id);

    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${trip.id}/map`);
    await expect(page.getByRole("heading", { name: "行程地图" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("TILE FALLBACK / SCHEMATIC WORLD")).toBeVisible({
      timeout: 30_000,
    });
    await expect(mapCanvas(page)).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: "简化世界地图，显示 2 个停靠点" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "定位停靠点 京都市" })).toBeVisible();
    await page.screenshot({
      path: resolve(WORKER_SHOT_DIR, "maplibre-worker-fallback-1440.png"),
      animations: "disabled",
    });
  });
});
