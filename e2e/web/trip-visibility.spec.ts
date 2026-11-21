/**
 * TRIP_VISIBILITY_E2E — custom grants on the real local stack.
 *
 * The journey starts from the product UI: the workspace owner/admin creates a
 * trip, switches it to `指定可见`, grants one workspace viewer, and saves. A
 * second viewer (same workspace, no grant) proves the list and direct-detail
 * boundary. Every assertion is made against rendered UI; the API is only used
 * to provision real accounts/sessions and to cross-check the server's 404.
 *
 * Run:
 *   pnpm exec playwright test e2e/web/trip-visibility.spec.ts --project=web --list
 *   pnpm exec playwright test e2e/web/trip-visibility.spec.ts --project=web --reporter=list
 *
 * Evidence (current code, real stack):
 *   .audit/trip-visibility/desktop-1440-owner-custom-grant.png
 *   .audit/trip-visibility/desktop-1440-granted-list.png
 *   .audit/trip-visibility/desktop-1440-granted-detail.png
 *   .audit/trip-visibility/desktop-1440-granted-edit-denied.png
 *   .audit/trip-visibility/desktop-1440-ungranted-list.png
 *   .audit/trip-visibility/desktop-1440-ungranted-detail.png
 *   .audit/trip-visibility/mobile-390-granted-detail.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  provisionWorkspaceMember,
  signInViaApi,
  type SmokeAccount,
} from "../support/accounts";

const WORKSPACE_SLUG = process.env.E2E_VISIBILITY_WORKSPACE_SLUG ?? "roamlog-crew";
const LIST_PATH = `/w/${WORKSPACE_SLUG}/trips`;
const SHOT_DIR = resolve(process.cwd(), ".audit/trip-visibility");
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const RUN_ID = Date.now().toString(36).toUpperCase();
const TRIP_TITLE = `可见性验收 ${RUN_ID}`;
const RUN_TOKEN = RUN_ID.toLowerCase();
const VIEWER_PASSWORD = "Roamlog-Visibility-Aa1!";
const GRANTEE_ACCOUNT: SmokeAccount = {
  email: `e2e-visibility-grant-${RUN_TOKEN}@roamlog.test`,
  password: VIEWER_PASSWORD,
  name: `可见性验收成员-${RUN_ID}`,
};
const OUTSIDER_ACCOUNT: SmokeAccount = {
  email: `e2e-visibility-outsider-${RUN_TOKEN}@roamlog.test`,
  password: VIEWER_PASSWORD,
  name: `可见性验收未授权-${RUN_ID}`,
};

test.use({ trace: "off" });

interface StoredSession {
  cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
}

interface WorkspaceRow {
  id: string;
  slug: string;
  role: string;
}

const sessionCache = new Map<string, Promise<StoredSession>>();

/** One real Better Auth sign-in per account, reused across the journey. */
async function apiSession(account: SmokeAccount): Promise<StoredSession> {
  const cached = sessionCache.get(account.email);
  if (cached) return cached;
  const pending = (async () => {
    const request = await playwrightRequest.newContext({ baseURL: API_URL });
    try {
      await signInViaApi(request, account, WEB_URL, API_URL);
      const state = await request.storageState();
      return { cookies: state.cookies };
    } finally {
      await request.dispose();
    }
  })();
  sessionCache.set(account.email, pending);
  return pending;
}

async function login(page: Page, account: SmokeAccount): Promise<void> {
  const session = await apiSession(account);
  await page.context().clearCookies();
  await page.context().addCookies(session.cookies);
  await page.goto(`/w/${WORKSPACE_SLUG}`);
}

async function newSessionPage(
  browser: Browser,
  session: StoredSession,
  viewport = DESKTOP,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: WEB_URL, viewport });
  await context.addCookies(session.cookies);
  const page = await context.newPage();
  return { context, page };
}

async function workspaceFor(page: Page, allowedRoles: readonly string[]): Promise<WorkspaceRow> {
  const response = await page.request.get("/v1/me/workspaces");
  expect(response.status(), await response.text()).toBe(200);
  const workspaces = (await response.json()) as WorkspaceRow[];
  const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
  expect(workspace, `workspace ${WORKSPACE_SLUG} must be visible`).toBeTruthy();
  expect(allowedRoles, `${WORKSPACE_SLUG} role`).toContain(workspace?.role);
  return workspace as WorkspaceRow;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function createTripThroughUi(page: Page): Promise<{ tripId: string; tripPath: string }> {
  await page.goto(`${LIST_PATH}/new`);
  const titleInput = page.getByLabel("旅行标题");
  await expect(titleInput).toBeVisible({ timeout: 30_000 });
  await titleInput.fill(TRIP_TITLE);
  await page.getByRole("button", { name: "创建旅行", exact: true }).click();

  await page.waitForURL(
    (url) =>
      new RegExp(`^/w/${escapeRegExp(WORKSPACE_SLUG)}/trips/[0-9a-f-]{20,}$`, "u").test(
        url.pathname,
      ),
    { timeout: 30_000 },
  );
  await expect(page.getByRole("heading", { name: TRIP_TITLE, exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const tripPath = new URL(page.url()).pathname;
  return { tripId: tripPath.split("/").pop() ?? "", tripPath };
}

async function setCustomGrantThroughUi(
  page: Page,
  tripPath: string,
  grantee: SmokeAccount,
): Promise<void> {
  await page.goto(`${tripPath}/edit`);
  const visibility = page.getByLabel("可见性");
  await expect(visibility).toBeVisible({ timeout: 30_000 });
  await visibility.selectOption({ label: "指定可见" });

  const grants = page.locator("#trip-access-grants");
  await expect(grants).toBeVisible({ timeout: 30_000 });
  await expect(grants.getByRole("heading", { name: "可见范围", exact: true })).toBeVisible();
  await expect(grants.getByLabel("搜索可见成员")).toBeVisible({ timeout: 30_000 });
  await expect(grants.getByText("正在读取可见范围…", { exact: true })).toHaveCount(0);

  await grants.getByLabel("搜索可见成员").fill(grantee.email);
  const checkbox = grants.getByRole("checkbox", {
    name: `选择可见成员 ${grantee.name}`,
    exact: true,
  });
  await expect(checkbox).toBeVisible({ timeout: 30_000 });
  await expect(checkbox).toBeEnabled();
  await checkbox.check();
  await expect(
    grants.getByText("这趟旅行将对 0 个工作区、1 位成员可见。", { exact: true }),
  ).toBeVisible();

  await grants.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(SHOT_DIR, "desktop-1440-owner-custom-grant.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "保存旅行", exact: true }).click();
  await page.waitForURL((url) => url.pathname === tripPath, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: TRIP_TITLE, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("指定可见", { exact: true })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("指定可见：Owner/Admin 授权、成员可见、未授权 404、Viewer 只读与刷新持久化", async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await mkdir(SHOT_DIR, { recursive: true });

  let tripId = "";
  let tripPath = "";
  let granteeSession: StoredSession | null = null;
  let completed = false;

  try {
    await test.step("Owner/Admin 通过 UI 创建旅行，provision 两名真实 Viewer，并设置 custom grant", async () => {
      await page.setViewportSize(DESKTOP);
      await login(page, OWNER_ACCOUNT);
      await workspaceFor(page, ["owner", "admin"]);
      provisionWorkspaceMember(GRANTEE_ACCOUNT, WORKSPACE_SLUG, "viewer");
      provisionWorkspaceMember(OUTSIDER_ACCOUNT, WORKSPACE_SLUG, "viewer");
      granteeSession = await apiSession(GRANTEE_ACCOUNT);

      const trip = await createTripThroughUi(page);
      tripId = trip.tripId;
      tripPath = trip.tripPath;
      expect(tripId).toMatch(/^[0-9a-f-]{20,}$/u);

      await page.getByRole("link", { name: "编辑旅行", exact: true }).click();
      await page.waitForURL((url) => url.pathname === `${tripPath}/edit`, { timeout: 30_000 });
      await setCustomGrantThroughUi(page, tripPath, GRANTEE_ACCOUNT);

      const persisted = await page.request.get(`/v1/trips/${tripId}/access-grants`);
      expect(persisted.status(), await persisted.text()).toBe(200);
      const body = (await persisted.json()) as {
        resolved?: { users?: Array<{ label?: string }> };
      };
      expect(body.resolved?.users?.some((entry) => entry.label === GRANTEE_ACCOUNT.name)).toBe(
        true,
      );
    });

    await test.step("被授权 Viewer：列表、详情、只读控件、刷新与移动端", async () => {
      const session = granteeSession;
      expect(session, "the invited viewer session must exist").toBeTruthy();
      if (!session) throw new Error("the invited viewer session is missing");
      const { context, page: grantedPage } = await newSessionPage(browser, session);
      try {
        await workspaceFor(grantedPage, ["viewer"]);
        const itineraryResponse = await grantedPage.request.get(`/v1/trips/${tripId}/itinerary`);
        expect(itineraryResponse.status(), await itineraryResponse.text()).toBe(200);

        await grantedPage.goto(LIST_PATH);
        const search = grantedPage.getByLabel("搜索旅行");
        await expect(search).toBeVisible({ timeout: 30_000 });
        await search.fill(TRIP_TITLE);

        const tripLink = grantedPage.locator(`a[href="${tripPath}"]`).filter({
          has: grantedPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
        });
        await expect(tripLink).toBeVisible({ timeout: 30_000 });
        await grantedPage.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-granted-list.png"),
          animations: "disabled",
        });

        const observed: Array<{ path: string; status: number }> = [];
        grantedPage.on("response", (response) => {
          const path = new URL(response.url()).pathname;
          if (
            path === `/v1/trips/${tripId}/stops` ||
            path === `/v1/trips/${tripId}/budget/summary`
          ) {
            observed.push({ path, status: response.status() });
          }
        });

        await tripLink.click();
        await expect(
          grantedPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(grantedPage.getByText("指定可见", { exact: true })).toBeVisible();

        const editButton = grantedPage.getByRole("button", { name: "编辑旅行", exact: true });
        await expect(editButton).toBeVisible();
        await expect(editButton).toBeDisabled();
        await expect(editButton).toHaveAttribute("title", /Viewer 只能阅读和评论/u);
        await expect(grantedPage.getByRole("link", { name: "编辑旅行", exact: true })).toHaveCount(
          0,
        );
        await expect(
          grantedPage.getByRole("button", { name: "保存旅行", exact: true }),
        ).toHaveCount(0);

        await grantedPage.getByRole("tab", { name: "行程", exact: true }).click();
        const itinerary = grantedPage.getByRole("tabpanel").first();
        await expect(itinerary).toBeVisible();
        const itineraryLoaded = itinerary
          .getByText("行程节点读取失败", { exact: true })
          .or(itinerary.getByText("还没有行程节点", { exact: true }));
        await expect(itineraryLoaded).toBeVisible({ timeout: 30_000 });
        await expect(itinerary.getByText("行程节点读取失败", { exact: true })).toHaveCount(0);
        await expect(
          itinerary.getByText("The requested trip was not found.", { exact: true }),
        ).toHaveCount(0);
        await expect(itinerary.getByText("0 个节点 · 按顺序排列", { exact: true })).toBeVisible();
        await expect(itinerary.getByText("还没有行程节点", { exact: true })).toBeVisible();
        expect(
          observed.some(
            (entry) => entry.path === `/v1/trips/${tripId}/stops` && entry.status === 200,
          ),
          "stops must return 200 for a custom-granted viewer",
        ).toBe(true);
        expect(
          observed.some(
            (entry) => entry.path === `/v1/trips/${tripId}/budget/summary` && entry.status === 200,
          ),
          "budget summary must return 200 for a custom-granted viewer",
        ).toBe(true);
        expect(
          observed.filter((entry) => entry.status === 404),
          "custom-granted child resources must not 404",
        ).toEqual([]);
        console.log(`VISIBILITY_NETWORK ${JSON.stringify(observed)}`);

        await grantedPage.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-granted-detail.png"),
          fullPage: true,
          animations: "disabled",
        });

        await grantedPage.goto(`${tripPath}/edit`);
        await expect(
          grantedPage.getByRole("heading", { name: "你没有编辑权限", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          grantedPage.getByText("当前工作区角色是 Viewer（只读）。", { exact: false }),
        ).toBeVisible();
        await grantedPage.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-granted-edit-denied.png"),
          animations: "disabled",
        });

        await grantedPage.getByRole("link", { name: "返回旅行详情", exact: true }).click();
        await expect(
          grantedPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await grantedPage.reload();
        await expect(
          grantedPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(grantedPage.getByText("指定可见", { exact: true })).toBeVisible();

        await grantedPage.setViewportSize(MOBILE);
        await grantedPage.reload();
        await expect(
          grantedPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(grantedPage.getByText("指定可见", { exact: true })).toBeVisible();
        await grantedPage.screenshot({
          path: resolve(SHOT_DIR, "mobile-390-granted-detail.png"),
          fullPage: true,
          animations: "disabled",
        });
      } finally {
        await context.close();
      }
    });

    await test.step("未授权 Viewer：列表不出现，直接访问详情显示无权限页面且 API 404", async () => {
      const session = await apiSession(OUTSIDER_ACCOUNT);
      const { context, page: outsiderPage } = await newSessionPage(browser, session);
      try {
        await outsiderPage.goto(LIST_PATH);
        await workspaceFor(outsiderPage, ["viewer"]);
        const search = outsiderPage.getByLabel("搜索旅行");
        await expect(search).toBeVisible({ timeout: 30_000 });
        await search.fill(TRIP_TITLE);
        await expect(outsiderPage.getByText("没有匹配的旅行", { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        await expect(outsiderPage.getByText(TRIP_TITLE, { exact: true })).toHaveCount(0);
        await outsiderPage.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-ungranted-list.png"),
          animations: "disabled",
        });

        const apiResponse = await outsiderPage.request.get(`/v1/trips/${tripId}`);
        expect(apiResponse.status(), await apiResponse.text()).toBe(404);

        await outsiderPage.goto(tripPath);
        await expect(
          outsiderPage.getByRole("heading", { name: "找不到这趟旅行", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          outsiderPage.getByText("旅行不存在、已归档，或当前账号没有访问权限。", { exact: true }),
        ).toBeVisible();
        await expect(
          outsiderPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
        ).toHaveCount(0);
        await outsiderPage.screenshot({
          path: resolve(SHOT_DIR, "desktop-1440-ungranted-detail.png"),
          animations: "disabled",
        });
      } finally {
        await context.close();
      }
    });

    completed = true;
  } finally {
    if (completed && tripId) {
      await page.request.delete(`/v1/trips/${tripId}`).catch(() => undefined);
    }
  }
});
