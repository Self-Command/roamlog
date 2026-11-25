/**
 * Stops place search — real-browser acceptance for the stop form.
 *
 * Real stack: Next.js web (:3000) + NestJS API (:4000) + PostgreSQL + real
 * Better Auth sessions. The third-party place provider is stubbed at
 * `/v1/places/search` so the journey can assert an exact city/country/address/
 * coordinate payload and a deterministic 503 without depending on Geoapify or
 * Photon availability. Everything else (trip create, stop create, persistence,
 * map read, RBAC) goes through the real API and database.
 *
 * Run:
 *   E2E_STOPS_WORKSPACE_SLUG=verify-crew E2E_SKIP_ADMIN_SERVER=1 \
 *     pnpm exec playwright test e2e/web/stops-place-search.spec.ts --project=web
 *
 * Screenshots:
 *   .audit/stops-place-search/desktop-1440-*.png (1440×1000)
 *   .audit/stops-place-search/mobile-390-*.png   (390×844)
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  loginOnWeb,
  provisionWorkspaceMember,
  type SmokeAccount,
} from "../support/accounts";

const SHOT_DIR = resolve(process.cwd(), ".audit/stops-place-search");
const WORKSPACE_SLUG = process.env.E2E_STOPS_WORKSPACE_SLUG ?? "roamlog-crew";
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

const STOPS_VIEWER_ACCOUNT: SmokeAccount = {
  email: "e2e-stops-viewer@roamlog.test",
  password: "Roamlog-Stops-Aa1!",
  name: "StopsViewer",
};

const SEARCHED_PLACE = {
  provider: "geoapify",
  providerPlaceId: "e2e-stops-kanazawa-001",
  name: "金泽",
  address: "金泽市, 石川县, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 36.5613,
  lng: 136.6562,
  timeZone: "Asia/Tokyo",
  bbox: [136.6, 36.5, 136.7, 36.6],
  importance: 0.9,
  type: "city",
} as const;

const SEARCH_RESPONSE = {
  items: [SEARCHED_PLACE],
  provider: "geoapify",
  degraded: false,
  cached: false,
};

// The local Windows runner intermittently loses the trace file while closing
// the browser context; screenshots + live API JSON are this journey's evidence.
test.use({ trace: "off" });

async function workspaceSlug(page: Page): Promise<string> {
  const response = await page.request.get(`${API_URL}/v1/me/workspaces`);
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as Array<{ slug: string }>;
  expect(
    workspaces.some((workspace) => workspace.slug === WORKSPACE_SLUG),
    `${OWNER_ACCOUNT.email} must belong to workspace ${WORKSPACE_SLUG}`,
  ).toBe(true);
  return WORKSPACE_SLUG;
}

async function createTripThroughUi(
  page: Page,
  slug: string,
  title: string,
): Promise<{ tripId: string; tripPath: string }> {
  await page.goto(`/w/${slug}/trips/new`);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("旅行标题").fill(title);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /^\/v1\/workspaces\/[^/]+\/trips$/u.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "创建旅行", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);

  await page.waitForURL(
    (url) => url.pathname.startsWith(`/w/${slug}/trips/`) && !url.pathname.endsWith("/new"),
    { timeout: 30_000 },
  );
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const tripPath = new URL(page.url()).pathname;
  const tripId = tripPath.split("/").at(-1) ?? "";
  expect(tripId).toMatch(/^[0-9a-f-]{20,}$/u);
  return { tripId, tripPath };
}

async function openAddStopDialog(page: Page): Promise<Locator> {
  const addButton = page.getByRole("button", { name: "添加节点", exact: true });
  await expect(addButton).toBeEnabled({ timeout: 30_000 });
  await addButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("添加行程节点", { exact: true })).toBeVisible();
  return dialog;
}

function dateOnly(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

async function fillStopDates(dialog: Locator): Promise<void> {
  await dialog.getByLabel("开始日期", { exact: true }).fill(dateOnly(1));
  await dialog.getByLabel("结束日期", { exact: true }).fill(dateOnly(3));
}

/**
 * The viewer is a reusable test-only account. Signing in creates a personal
 * workspace, which makes the user undeletable through the provisioning
 * helper's plain `user.delete()` (Workspace_ownerId_fkey). Reuse it when it is
 * already a viewer in the target workspace; only create it on the first run.
 */
async function ensureStopsViewer(): Promise<void> {
  const api = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    const signIn = await api.post(`${API_URL}/v1/auth/sign-in/email`, {
      headers: { origin: WEB_URL, "content-type": "application/json" },
      data: {
        email: STOPS_VIEWER_ACCOUNT.email,
        password: STOPS_VIEWER_ACCOUNT.password,
        rememberMe: true,
      },
    });
    if (signIn.ok()) {
      const workspacesResponse = await api.get(`${API_URL}/v1/me/workspaces`);
      expect(workspacesResponse.status(), await workspacesResponse.text()).toBe(200);
      const workspaces = (await workspacesResponse.json()) as Array<{
        slug: string;
        role: string;
      }>;
      if (
        workspaces.some(
          (workspace) => workspace.slug === WORKSPACE_SLUG && workspace.role === "viewer",
        )
      ) {
        return;
      }
      throw new Error(
        `${STOPS_VIEWER_ACCOUNT.email} exists but is not a viewer in ${WORKSPACE_SLUG}`,
      );
    }
  } finally {
    await api.dispose();
  }
  provisionWorkspaceMember(STOPS_VIEWER_ACCOUNT, WORKSPACE_SLUG, "viewer");
}

test.describe("stops place search in the real UI", () => {
  test("search → fill → save → refresh → map; 503 manual fallback; Viewer denied", async ({
    browser,
    page,
  }) => {
    test.setTimeout(300_000);
    await mkdir(SHOT_DIR, { recursive: true });

    const runId = Date.now().toString(36);
    const tripTitle = `停靠点搜索验收 ${runId}`;
    let tripId = "";
    let tripPath = "";
    let stopId = "";
    let searchMode: "ok" | "error" = "ok";
    let blockInitialStops = true;
    let releaseStops: (() => void) | undefined;
    const stopsGate = new Promise<void>((resolve) => {
      releaseStops = resolve;
    });
    const observed: Array<{ path: string; status: number; query?: string }> = [];

    await page.route("**/v1/trips/*/stops", async (route) => {
      if (route.request().method() === "GET" && blockInitialStops) {
        await stopsGate;
      }
      await route.continue();
    });

    await page.route("**/v1/places/search**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      if (searchMode === "error") {
        observed.push({ path: "/v1/places/search", status: 503, query });
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            detail: "Place provider is unavailable.",
          }),
        });
        return;
      }
      observed.push({ path: "/v1/places/search", status: 200, query });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SEARCH_RESPONSE),
      });
    });

    try {
      await page.setViewportSize(DESKTOP);
      await loginOnWeb(page, OWNER_ACCOUNT);
      const slug = await workspaceSlug(page);

      await test.step("Owner creates a trip through the UI and opens 添加节点", async () => {
        try {
          const trip = await createTripThroughUi(page, slug, tripTitle);
          tripId = trip.tripId;
          tripPath = trip.tripPath;
          await expect(page.getByText("读取中", { exact: true })).toBeVisible({
            timeout: 5_000,
          });
        } finally {
          blockInitialStops = false;
          releaseStops?.();
        }
        await page.unroute("**/v1/trips/*/stops");
        await expect(page.getByText("还没有行程节点", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          page.getByRole("button", { name: "添加第一个节点", exact: true }),
        ).toBeVisible();
        await openAddStopDialog(page);
      });

      await test.step("Selecting a search result fills city, country, code, coordinates and address", async () => {
        const dialog = page.getByRole("dialog");
        const input = dialog.getByRole("combobox", { name: "搜索地点" });
        await input.fill("金泽");

        const listbox = page.getByRole("listbox", { name: "搜索地点建议" });
        await expect(listbox).toBeVisible({ timeout: 30_000 });
        const option = listbox.getByRole("option").filter({ hasText: "日本" }).first();
        await expect(option).toContainText("金泽");
        await expect(option).toContainText("JP");
        await expect(option).toContainText("金泽市, 石川县, 日本");
        await page.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-search-results.png"),
          animations: "disabled",
        });
        await option.click();

        await expect(dialog.getByLabel("城市", { exact: true })).toHaveValue("金泽");
        await expect(dialog.getByLabel("国家", { exact: true })).toHaveValue("日本");
        await expect(dialog.getByLabel("国家码", { exact: true })).toHaveValue("JP");
        await expect(dialog.getByLabel("纬度（可选）", { exact: true })).toHaveValue("36.5613");
        await expect(dialog.getByLabel("经度（可选）", { exact: true })).toHaveValue("136.6562");

        await page.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-place-selected.png"),
          animations: "disabled",
        });
      });

      await test.step("Saving persists the stop and its place metadata", async () => {
        const dialog = page.getByRole("dialog");
        await fillStopDates(dialog);

        const createPromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === `/v1/trips/${tripId}/stops`,
        );
        await dialog.getByRole("button", { name: "保存节点", exact: true }).click();
        const createResponse = await createPromise;
        observed.push({ path: `/v1/trips/${tripId}/stops`, status: createResponse.status() });
        expect(createResponse.status(), await createResponse.text()).toBe(201);
        await expect(dialog).toBeHidden();

        const row = page.getByRole("listitem").filter({ hasText: "金泽" }).first();
        await expect(row).toContainText("日本 · JP", { timeout: 30_000 });
        await expect(row).toContainText("金泽市, 石川县, 日本");
        await expect(row).toContainText("36.5613, 136.6562");
        await expect(row).toContainText("Asia/Tokyo");

        const stopsResponse = await page.request.get(`${API_URL}/v1/trips/${tripId}/stops`);
        observed.push({ path: `/v1/trips/${tripId}/stops`, status: stopsResponse.status() });
        expect(stopsResponse.status(), await stopsResponse.text()).toBe(200);
        const stops = (await stopsResponse.json()) as Array<Record<string, unknown>>;
        expect(stops).toHaveLength(1);
        const stop = stops[0]!;
        stopId = String(stop.id);
        expect(stop.city).toBe("金泽");
        expect(stop.country).toBe("日本");
        expect(stop.countryCode).toBe("JP");
        expect(stop.lat).toBe(36.5613);
        expect(stop.lng).toBe(136.6562);
        expect(stop.provider).toBe("geoapify");
        expect(stop.providerPlaceId).toBe("e2e-stops-kanazawa-001");
        expect(stop.timeZone).toBe("Asia/Tokyo");
        expect(stop.address).toBe("金泽市, 石川县, 日本");
        expect(stop.bbox).toEqual([136.6, 36.5, 136.7, 36.6]);

        await page.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-stop-persisted.png"),
          animations: "disabled",
        });
      });

      await test.step("The stop appears on the trip map with coordinates", async () => {
        await page.goto(`${tripPath}/map`);
        await expect(page.getByRole("heading", { name: "行程地图", exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByText(/ROUTE \/ 1 MAPPED STOPS/u)).toBeVisible();
        const sidebar = page.getByTestId("trip-map-sidebar");
        await expect(sidebar).toContainText("金泽 · 日本");
        await page.getByTestId(`trip-map-stop-${stopId}`).click();
        await expect(page.getByTestId("trip-map-selected-stop")).toContainText("36.5613, 136.6562");
        await page.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-map-stop.png"),
          fullPage: true,
          animations: "disabled",
        });
      });

      await test.step("Refresh keeps the stop; mobile 390 shows the persisted row", async () => {
        await page.goto(tripPath);
        const row = page.getByRole("listitem").filter({ hasText: "金泽" }).first();
        await expect(row).toBeVisible({ timeout: 30_000 });

        await page.reload();
        await expect(row).toBeVisible({ timeout: 30_000 });
        await expect(row).toContainText("金泽市, 石川县, 日本");
        await expect(row).toContainText("36.5613, 136.6562");

        await page.setViewportSize(MOBILE);
        await page.reload();
        await expect(row).toBeVisible({ timeout: 30_000 });
        await page.screenshot({
          path: resolve(SHOT_DIR, "mobile-390-stop-persisted.png"),
          fullPage: true,
          animations: "disabled",
        });
      });

      await test.step("A provider 503 keeps manual entry usable and saves a manual stop", async () => {
        await page.setViewportSize(DESKTOP);
        await page.goto(tripPath);
        await openAddStopDialog(page);
        const dialog = page.getByRole("dialog");
        searchMode = "error";

        const input = dialog.getByRole("combobox", { name: "搜索地点" });
        await input.fill("兰州");
        const listbox = page.getByRole("listbox", { name: "搜索地点建议" });
        await expect(listbox.getByRole("status")).toContainText("地点搜索暂时不可用", {
          timeout: 30_000,
        });
        await expect(listbox.getByRole("button", { name: "重试", exact: true })).toBeVisible();
        const manual = listbox.getByRole("option", { name: /使用「兰州」作为城市/u });
        await expect(manual).toBeVisible();

        await page.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-search-error-manual.png"),
          animations: "disabled",
        });

        await manual.click();
        await expect(dialog.getByLabel("城市", { exact: true })).toHaveValue("兰州");
        await dialog.getByLabel("国家", { exact: true }).fill("中国");
        await dialog.getByLabel("国家码", { exact: true }).fill("CN");
        await dialog.getByLabel("纬度（可选）", { exact: true }).fill("36.0611");
        await dialog.getByLabel("经度（可选）", { exact: true }).fill("103.8343");
        await fillStopDates(dialog);

        const createPromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === `/v1/trips/${tripId}/stops`,
        );
        await dialog.getByRole("button", { name: "保存节点", exact: true }).click();
        const createResponse = await createPromise;
        observed.push({ path: `/v1/trips/${tripId}/stops`, status: createResponse.status() });
        expect(createResponse.status(), await createResponse.text()).toBe(201);
        await expect(dialog).toBeHidden();

        const row = page.getByRole("listitem").filter({ hasText: "兰州" }).first();
        await expect(row).toContainText("中国 · CN", { timeout: 30_000 });
        await expect(row).toContainText("36.0611, 103.8343");

        const stopsResponse = await page.request.get(`${API_URL}/v1/trips/${tripId}/stops`);
        expect(stopsResponse.status(), await stopsResponse.text()).toBe(200);
        const stops = (await stopsResponse.json()) as Array<Record<string, unknown>>;
        expect(stops).toHaveLength(2);
        const manualStop = stops.find((entry) => entry.city === "兰州");
        expect(manualStop).toBeTruthy();
        expect(manualStop?.provider).toBeNull();
        expect(manualStop?.address).toBeNull();
        expect(manualStop?.lat).toBe(36.0611);
        expect(manualStop?.lng).toBe(103.8343);
      });

      await test.step("Viewer sees the stops but cannot open the add/search form", async () => {
        await ensureStopsViewer();

        const viewerContext = await browser.newContext({
          baseURL: "http://localhost:3000",
          viewport: DESKTOP,
        });
        const viewerPage = await viewerContext.newPage();
        try {
          await loginOnWeb(viewerPage, STOPS_VIEWER_ACCOUNT);
          await viewerPage.goto(tripPath);
          await expect(
            viewerPage.getByRole("heading", { name: tripTitle, exact: true }),
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            viewerPage.getByRole("listitem").filter({ hasText: "金泽" }).first(),
          ).toBeVisible({ timeout: 30_000 });

          const addButton = viewerPage.getByRole("button", {
            name: "添加节点",
            exact: true,
          });
          await expect(addButton).toBeDisabled();
          await expect(addButton).toHaveAttribute(
            "title",
            "你是只读成员，只能阅读和评论，不能添加行程节点。请联系工作区所有者或管理员调整权限。",
          );
          await expect(viewerPage.getByRole("combobox", { name: "搜索地点" })).toHaveCount(0);
          await addButton.click({ force: true });
          await expect(viewerPage.getByRole("dialog")).toHaveCount(0);

          const editButton = viewerPage.getByRole("button", {
            name: "编辑行程节点 金泽",
            exact: true,
          });
          await expect(editButton).toBeDisabled();
          await expect(editButton).toHaveAttribute(
            "title",
            "你是只读成员，只能阅读和评论，不能编辑行程节点。请联系工作区所有者或管理员调整权限。",
          );

          await viewerPage.screenshot({
            path: resolve(SHOT_DIR, "desktop-1440-viewer-denied.png"),
            animations: "disabled",
          });
        } finally {
          await viewerContext.close();
        }
      });

      console.log(`STOPS_NETWORK ${JSON.stringify(observed)}`);
    } finally {
      if (tripId) {
        await page.request.delete(`${API_URL}/v1/trips/${tripId}`).catch(() => undefined);
      }
    }
  });
});
