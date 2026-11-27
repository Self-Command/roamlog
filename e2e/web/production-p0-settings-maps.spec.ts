import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

const BASE = (process.env.E2E_WEB_URL ?? "https://we.spacedo.org").replace(/\/+$/u, "");
const SSH_HOST = process.env.E2E_PROD_SSH ?? "root@217.217.197.188";
const PG_CONTAINER = process.env.E2E_PROD_PG_CONTAINER ?? "roamlog-postgres-1";
const RUN_ID = `prod-p0-${Date.now().toString(36)}`;
const RUN_TOKEN = RUN_ID.replace(/[^a-z0-9-]/gu, "");
const PASSWORD = "Roamlog-P0-Aa1!";
const WRONG_PASSWORD = "Definitely-Wrong-P0-123!";
const OWNER = {
  email: `${RUN_ID}-owner@roamlog.test`,
  password: PASSWORD,
  name: `P0 Owner ${RUN_ID}`,
};
const EDITOR = {
  email: `${RUN_ID}-editor@roamlog.test`,
  password: PASSWORD,
  name: `P0 Editor ${RUN_ID}`,
};
const VIEWER = {
  email: `${RUN_ID}-viewer@roamlog.test`,
  password: PASSWORD,
  name: `P0 Viewer ${RUN_ID}`,
};
const SECURITY = {
  email: `${RUN_ID}-security@roamlog.test`,
  password: PASSWORD,
  name: `P0 Security ${RUN_ID}`,
};
const WORKSPACE_NAME = `P0 生产验收 ${RUN_ID}`;
const WORKSPACE_SLUG = `${RUN_TOKEN}-workspace`;
const EMPTY_WORKSPACE_NAME = `P0 空洞察 ${RUN_ID}`;
const EMPTY_WORKSPACE_SLUG = `${RUN_TOKEN}-empty`;
const SEED_TRIP_TITLE = `P0 通知与洞察 ${RUN_ID}`;
const NO_STOPS_TRIP_TITLE = `P0 无停靠点 ${RUN_ID}`;
const UNMAPPED_TRIP_TITLE = `P0 无坐标 ${RUN_ID}`;
const ENTRY_TITLE = `P0 评论日志 ${RUN_ID}`;
const FIRST_COMMENT = `P0 Viewer 第一条真实评论 ${RUN_ID}`;
const SECOND_COMMENT = `P0 Viewer 第二条真实评论 ${RUN_ID}`;
const SHOT_DIR = path.resolve(process.cwd(), ".audit", "production", RUN_ID);
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const TRIP_START = "2026-11-10";
const TRIP_END = "2026-11-14";
const EXPENSE_DATE = "2026-11-12";
const KYOTO_IMAGE = readFileSync(
  path.resolve(process.cwd(), "packages/db/seed-assets/kyoto-alley.jpg"),
);
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAAnklEQVR42u3bsQkAIAwAwdTBHbKqm+sGdkIgBz/B9R9nlx4FAkCAAAECBAgQIAECBAgQIECAAAkQIECAAA0Cylw9AwQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAAB6gPkWQUkQIAAAQIECBAgAQIECBAgQIAACRAgQL+7xNIRWJpkdecAAAAASUVORK5CYII=",
  "base64",
);

type StoredSession = {
  cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
};

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  role: string;
}

interface NotificationPreference {
  type: string;
  inApp: boolean;
  email: boolean;
}

let ownerApi: APIRequestContext;
let editorApi: APIRequestContext;
let viewerApi: APIRequestContext;
let ownerState: StoredSession;
let editorState: StoredSession;
let viewerState: StoredSession;
let ownerId = "";
let editorId = "";
let viewerId = "";
let securityId = "";
let workspaceId = "";
let emptyWorkspaceId = "";
let seedTripId = "";
let entryId = "";
let noStopsTripId = "";
let unmappedTripId = "";

function sql(statement: string): string {
  const encoded = Buffer.from(statement, "utf8").toString("base64");
  return execSync(
    `ssh ${SSH_HOST} "printf '%s' '${encoded}' | base64 -d | docker exec -i ${PG_CONTAINER} psql -U roamlog -d roamlog -v ON_ERROR_STOP=1 -f -"`,
    { encoding: "utf8" },
  );
}

async function postWithRetry(
  api: APIRequestContext,
  requestPath: string,
  data: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext["post"]>>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await api.post(requestPath, {
      headers: { origin: BASE, "content-type": "application/json" },
      data,
    });
    if (response.status() !== 429) return response;
    const retryAfter = Number(response.headers()["retry-after"] ?? "15");
    await new Promise((resolve) => {
      setTimeout(resolve, Math.max(2_000, Math.min(retryAfter, 90) * 1_000));
    });
  }
  return api.post(requestPath, {
    headers: { origin: BASE, "content-type": "application/json" },
    data,
  });
}

async function signUp(
  api: APIRequestContext,
  account: { email: string; password: string; name: string },
): Promise<string> {
  const response = await postWithRetry(api, "/v1/auth/sign-up/email", {
    email: account.email,
    password: account.password,
    name: account.name,
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { user: { id: string } }).user.id;
}

async function signIn(
  api: APIRequestContext,
  account: { email: string; password: string },
): Promise<void> {
  const response = await postWithRetry(api, "/v1/auth/sign-in/email", {
    email: account.email,
    password: account.password,
    rememberMe: true,
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function stateOf(api: APIRequestContext): Promise<StoredSession> {
  const state = await api.storageState();
  return { cookies: state.cookies };
}

async function newPage(
  browser: Browser,
  session: StoredSession,
  viewport = DESKTOP,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport,
    extraHTTPHeaders: { Origin: BASE },
  });
  await context.addCookies(session.cookies);
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
  expect(overflow, `${label} 不应出现横向溢出`).toBeLessThanOrEqual(1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

async function createTripRequest(
  api: APIRequestContext,
  title: string,
  options: { budget?: boolean; destinations?: boolean } = {},
): Promise<string> {
  const response = await api.post(`/v1/workspaces/${workspaceId}/trips`, {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      title,
      summary: `${title} 的真实生产验收数据。`,
      status: "upcoming",
      startDate: TRIP_START,
      endDate: TRIP_END,
      timeZone: "Asia/Shanghai",
      destinationsV2:
        options.destinations === false
          ? []
          : [
              {
                name: "京都",
                country: "日本",
                countryCode: "JP",
                lat: 35.0116,
                lng: 135.7681,
                timeZone: "Asia/Tokyo",
              },
            ],
      tags: ["P0"],
      ...(options.budget
        ? {
            budgetAmountMinor: 200000,
            budgetCurrency: "CNY",
          }
        : {}),
      visibility: "workspace",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function seed(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  ownerApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  editorApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  viewerApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  const securityApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });

  ownerId = await signUp(ownerApi, OWNER);
  editorId = await signUp(editorApi, EDITOR);
  viewerId = await signUp(viewerApi, VIEWER);
  securityId = await signUp(securityApi, SECURITY);
  await securityApi.dispose();

  sql(`
UPDATE "User" SET "emailVerified" = true
WHERE email IN ('${OWNER.email}','${EDITOR.email}','${VIEWER.email}','${SECURITY.email}');
DELETE FROM "Session"
WHERE "userId" = '${securityId}';
`);

  await signIn(ownerApi, OWNER);
  await signIn(editorApi, EDITOR);
  await signIn(viewerApi, VIEWER);

  const workspace = await ownerApi.post("/v1/workspaces", {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
    },
  });
  expect(workspace.status(), await workspace.text()).toBe(201);
  workspaceId = ((await workspace.json()) as { id: string }).id;

  const emptyWorkspace = await ownerApi.post("/v1/workspaces", {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      name: EMPTY_WORKSPACE_NAME,
      slug: EMPTY_WORKSPACE_SLUG,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
    },
  });
  expect(emptyWorkspace.status(), await emptyWorkspace.text()).toBe(201);
  emptyWorkspaceId = ((await emptyWorkspace.json()) as { id: string }).id;

  sql(`
INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role, status, "joinedAt", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), '${workspaceId}', '${editorId}', 'editor', 'active', now(), now(), now()),
  (gen_random_uuid(), '${workspaceId}', '${viewerId}', 'viewer', 'active', now(), now(), now()),
  (gen_random_uuid(), '${workspaceId}', '${securityId}', 'viewer', 'active', now(), now(), now());
`);

  seedTripId = await createTripRequest(ownerApi, SEED_TRIP_TITLE, { budget: true });
  noStopsTripId = await createTripRequest(ownerApi, NO_STOPS_TRIP_TITLE, {
    destinations: false,
  });
  unmappedTripId = await createTripRequest(ownerApi, UNMAPPED_TRIP_TITLE, {
    destinations: false,
  });

  const unmappedStop = await ownerApi.post(`/v1/trips/${unmappedTripId}/stops`, {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      city: "兰州",
      country: "中国",
      countryCode: "CN",
      startDate: TRIP_START,
      endDate: TRIP_END,
      notes: "该停靠点刻意没有经纬度，用于验证地图空态。",
    },
  });
  expect(unmappedStop.status(), await unmappedStop.text()).toBe(201);

  const seededEntry = await ownerApi.post(`/v1/trips/${seedTripId}/entries`, {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      title: ENTRY_TITLE,
      date: "2026-11-11",
      location: "京都",
      lat: 35.0116,
      lng: 135.7681,
      mood: "happy",
      weather: "sunny",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "P0 通知与活动验收日志正文。" }],
          },
        ],
      },
      contentHtml: "<p>P0 通知与活动验收日志正文。</p>",
      excerpt: "P0 通知与活动验收日志",
      tags: ["P0"],
    },
  });
  expect(seededEntry.status(), await seededEntry.text()).toBe(201);
  entryId = ((await seededEntry.json()) as { id: string }).id;

  for (const expense of [
    { category: "food", note: "P0 餐饮支出", amountMinor: 4321 },
    { category: "transport", note: "P0 交通支出", amountMinor: 1234 },
  ]) {
    const response = await ownerApi.post(`/v1/trips/${seedTripId}/expenses`, {
      headers: { origin: BASE, "content-type": "application/json" },
      data: {
        date: EXPENSE_DATE,
        category: expense.category,
        note: expense.note,
        amountMinor: expense.amountMinor,
        currency: "CNY",
        paidById: ownerId,
        splitMode: "equal",
        participants: [{ userId: ownerId }],
      },
    });
    expect(response.status(), await response.text()).toBe(201);
  }

  ownerState = await stateOf(ownerApi);
  editorState = await stateOf(editorApi);
  viewerState = await stateOf(viewerApi);

  writeFileSync(
    path.join(SHOT_DIR, "seed.json"),
    JSON.stringify(
      {
        runId: RUN_ID,
        workspaceId,
        emptyWorkspaceId,
        workspaceSlug: WORKSPACE_SLUG,
        seedTripId,
        entryId,
        noStopsTripId,
        unmappedTripId,
      },
      null,
      2,
    ),
  );
}

async function loginThroughUi(
  page: Page,
  account: { email: string; password: string },
): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

test.describe.configure({ retries: 0 });
test.use({ trace: "off" });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

test.afterAll(async () => {
  try {
    sql(`
DELETE FROM "Workspace"
WHERE "ownerId" IN (SELECT id FROM "User" WHERE email LIKE '${RUN_ID}-%');
DELETE FROM "User" WHERE email LIKE '${RUN_ID}-%';
`);
  } finally {
    await Promise.all([ownerApi?.dispose(), editorApi?.dispose(), viewerApi?.dispose()]);
  }
});

test("设置个人资料：头像与显示名保存、刷新持久", async ({ browser }) => {
  test.setTimeout(300_000);
  const { page, close } = await newPage(browser, ownerState);
  try {
    const originalResponse = await page.request.get("/v1/me");
    expect(originalResponse.status(), await originalResponse.text()).toBe(200);
    const original = (await originalResponse.json()) as {
      name: string;
      image: string | null;
      timezone: string;
      locale: string;
    };

    await page.goto(`/w/${WORKSPACE_SLUG}/settings/profile`);
    await expect(page.getByRole("heading", { name: "个人资料", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    const avatarSection = page.locator('section[aria-label="头像"]');
    await expect(avatarSection).toBeVisible();

    const avatarPatch = page.waitForResponse(
      (response) => response.url().endsWith("/v1/me") && response.request().method() === "PATCH",
      { timeout: 90_000 },
    );
    await page.getByTestId("avatar-file-input").setInputFiles({
      name: "p0-avatar.jpg",
      mimeType: "image/jpeg",
      buffer: KYOTO_IMAGE,
    });
    const avatarResponse = await avatarPatch;
    expect(avatarResponse.status(), await avatarResponse.text()).toBe(200);
    await expect(page.getByText("头像已更新。")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await avatarSection.locator("img").getAttribute("src")) ?? "", {
        timeout: 60_000,
      })
      .toContain("X-Amz-Signature");
    const uploadedImage = await avatarSection.locator("img").getAttribute("src");

    const nextName = `P0 Owner 已保存 ${RUN_ID}`;
    await page.getByLabel(/^显示名称/).fill(nextName);
    const nameSave = page.waitForResponse(
      (response) => response.url().endsWith("/v1/me") && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "保存个人资料" }).click();
    expect((await nameSave).status()).toBe(200);
    await expect(page.getByText("个人资料已保存。")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/^显示名称/)).toHaveValue(nextName, {
      timeout: 30_000,
    });
    const reloadedImage = await avatarSection.locator("img").getAttribute("src");
    expect(reloadedImage).toContain("X-Amz-Signature");
    expect(new URL(reloadedImage ?? BASE).pathname).toBe(new URL(uploadedImage ?? BASE).pathname);
    const persisted = (await (await page.request.get("/v1/me")).json()) as {
      name: string;
      image: string | null;
    };
    expect(persisted.name).toBe(nextName);
    expect(new URL(persisted.image ?? BASE).pathname).toBe(new URL(uploadedImage ?? BASE).pathname);

    await shot(page, "01-profile-1440");
    await page.setViewportSize(MOBILE);
    await expectNoOverflow(page, "个人资料 390");
    await shot(page, "01-profile-390");

    const restore = await page.request.patch("/v1/me", {
      headers: { origin: BASE, "content-type": "application/json" },
      data: {
        name: original.name,
        image: original.image,
        timezone: original.timezone,
        locale: original.locale,
      },
    });
    expect(restore.status(), await restore.text()).toBe(200);
  } finally {
    await close();
  }
});

test("设置通知偏好：切换、刷新持久、API 一致", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, close } = await newPage(browser, ownerState);
  try {
    const response = await page.request.get("/v1/me/notification-preferences");
    expect(response.status(), await response.text()).toBe(200);
    const original = (await response.json()) as NotificationPreference[];
    const initialMention = original.find((preference) => preference.type === "mention") ?? null;

    await page.goto(`/w/${WORKSPACE_SLUG}/settings/notifications`);
    await expect(page.getByRole("heading", { name: "通知", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    const section = page.locator('section[aria-label="通知偏好"]');
    await expect(section).toBeVisible();
    const before = initialMention?.email ?? true;
    const toggle = section.getByRole("switch", { name: "提及的邮件通知" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-checked", String(before));

    const save = page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/v1/me/notification-preferences") &&
        candidate.request().method() === "PATCH",
    );
    await toggle.click();
    expect((await save).status()).toBe(200);
    await expect(page.getByText("通知偏好已保存。")).toBeVisible();
    const after = await toggle.getAttribute("aria-checked");
    expect(after).not.toBe(String(before));

    await page.reload();
    await expect(
      page
        .locator('section[aria-label="通知偏好"]')
        .getByRole("switch", { name: "提及的邮件通知" }),
    ).toHaveAttribute("aria-checked", after ?? "", { timeout: 30_000 });
    const persisted = (await (
      await page.request.get("/v1/me/notification-preferences")
    ).json()) as NotificationPreference[];
    expect(persisted.find((preference) => preference.type === "mention")?.email).toBe(
      after === "true",
    );

    await shot(page, "02-notification-preferences-1440");
    await page.setViewportSize(MOBILE);
    await expectNoOverflow(page, "通知偏好 390");
    await shot(page, "02-notification-preferences-390");

    const restore = await page.request.patch("/v1/me/notification-preferences", {
      headers: { origin: BASE, "content-type": "application/json" },
      data: {
        preferences:
          original.length > 0
            ? original.map(({ type, inApp, email }) => ({
                type,
                inApp,
                email,
              }))
            : [
                { type: "mention", inApp: true, email: true },
                { type: "comment_reply", inApp: true, email: true },
                { type: "comment", inApp: true, email: true },
              ],
      },
    });
    expect(restore.status(), await restore.text()).toBe(200);
  } finally {
    await close();
  }
});

test("工作区设置：Logo、周起始、可见性、密度、强调色、通知刷新持久", async ({ browser }) => {
  test.setTimeout(300_000);
  const { page, close } = await newPage(browser, ownerState);
  try {
    await page.goto(`/w/${WORKSPACE_SLUG}/settings/workspace`);
    await expect(page.getByRole("heading", { name: "工作区设置" })).toBeVisible({
      timeout: 30_000,
    });

    const logoSection = page.locator("section[aria-labelledby='workspace-logo-title']");
    await expect(logoSection).toBeVisible();
    const logoPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/v1/workspaces/${workspaceId}`,
      { timeout: 120_000 },
    );
    await page.getByLabel("选择工作区标志").setInputFiles({
      name: "p0-workspace-logo.png",
      mimeType: "image/png",
      buffer: LOGO_PNG,
    });
    expect((await logoPatch).status()).toBe(200);
    await expect(page.getByText("工作区标志已更新。")).toBeVisible({
      timeout: 90_000,
    });

    await page.getByLabel("周起始日").selectOption("3");
    await page.getByLabel("默认可见性").selectOption("private");
    await page.getByLabel("界面密度").selectOption("compact");
    await page.getByLabel("强调色十六进制值").fill("#3b9eff");
    const inApp = page.getByLabel("站内通知");
    if ((await inApp.getAttribute("data-state")) === "checked") {
      await inApp.click();
    }
    await expect(inApp).toHaveAttribute("data-state", "unchecked");

    const settingsPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/v1/workspaces/${workspaceId}`,
      { timeout: 120_000 },
    );
    await page.getByRole("button", { name: "保存更改" }).click();
    const saved = await settingsPatch;
    expect(saved.status(), await saved.text()).toBe(200);
    const body = JSON.parse(saved.request().postData() ?? "{}") as {
      weekStartsOn?: number;
      settings?: Record<string, unknown>;
    };
    expect(body.weekStartsOn).toBe(3);
    expect(body.settings).toMatchObject({
      defaultVisibility: "private",
      density: "compact",
      accentColor: "#3b9eff",
      notificationDefaults: { inApp: false, email: true },
    });
    await expect(page.getByText("工作区设置已保存。")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("周起始日")).toHaveValue("3", {
      timeout: 30_000,
    });
    await expect(page.getByLabel("默认可见性")).toHaveValue("private");
    await expect(page.getByLabel("界面密度")).toHaveValue("compact");
    await expect(page.getByLabel("强调色十六进制值")).toHaveValue("#3b9eff");
    await expect(page.getByLabel("站内通知")).toHaveAttribute("data-state", "unchecked");
    await expect(page.locator("section[aria-labelledby='workspace-logo-title'] img")).toBeVisible({
      timeout: 30_000,
    });

    await shot(page, "03-workspace-settings-1440");
    await page.setViewportSize(MOBILE);
    await expectNoOverflow(page, "工作区设置 390");
    await shot(page, "03-workspace-settings-390");
  } finally {
    await close();
  }
});

test("危险区：删除与转移都要求二次确认且取消后不执行", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, close } = await newPage(browser, ownerState);
  try {
    await page.goto(`/w/${WORKSPACE_SLUG}/settings/danger`);
    await expect(page.getByRole("heading", { name: "危险区" })).toBeVisible({
      timeout: 30_000,
    });
    const deleteCard = page.getByRole("region", { name: "删除工作区" });
    const transferCard = page.getByRole("region", { name: "转移所有权" });
    await expect(deleteCard).toBeVisible();
    await expect(transferCard).toBeVisible();

    await deleteCard.getByRole("button", { name: "删除此工作区" }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(deleteDialog.getByText("删除工作区")).toBeVisible();
    const confirmDelete = deleteDialog.getByRole("button", { name: "确认删除" });
    await expect(confirmDelete).toBeDisabled();
    await deleteDialog.getByLabel("输入工作区名称以确认").fill(WORKSPACE_NAME);
    await expect(confirmDelete).toBeEnabled();
    await deleteDialog.getByRole("button", { name: "取消" }).click();
    await expect(deleteDialog).not.toBeVisible();

    await transferCard.getByRole("button", { name: "转移所有权" }).click();
    const transferDialog = page.getByRole("dialog");
    await expect(transferDialog.getByRole("heading", { name: "确认转移所有权" })).toBeVisible();
    await expect(transferDialog.getByRole("button", { name: "确认转移" })).toBeDisabled();
    await transferDialog.getByRole("button", { name: "取消" }).click();
    await expect(transferDialog).not.toBeVisible();

    const workspaceResponse = await page.request.get("/v1/me/workspaces");
    expect(workspaceResponse.status(), await workspaceResponse.text()).toBe(200);
    const workspaces = (await workspaceResponse.json()) as WorkspaceRow[];
    expect(workspaces.some((workspace) => workspace.id === workspaceId)).toBe(true);

    await shot(page, "04-danger-guards-1440");
    await page.setViewportSize(MOBILE);
    await expectNoOverflow(page, "危险区 390");
    await shot(page, "04-danger-guards-390");
  } finally {
    await close();
  }
});

test("指定可见：Editor 被授权可编辑，未授权 Viewer 列表不可见且直链 404", async ({ browser }) => {
  test.setTimeout(420_000);
  const owner = await newPage(browser, ownerState);
  try {
    await owner.page.goto(`/w/${WORKSPACE_SLUG}/trips/new`);
    await expect(owner.page.getByRole("heading", { name: "新建旅行" })).toBeVisible({
      timeout: 30_000,
    });
    const title = `P0 指定可见 ${RUN_ID}`;
    await owner.page.getByLabel("旅行标题").fill(title);
    await owner.page.getByRole("button", { name: "创建旅行", exact: true }).click();
    await owner.page.waitForURL(
      (url) =>
        new RegExp(`^/w/${escapeRegExp(WORKSPACE_SLUG)}/trips/[0-9a-f-]{20,}$`, "u").test(
          url.pathname,
        ),
      { timeout: 30_000 },
    );
    const tripPath = new URL(owner.page.url()).pathname;
    const tripId = tripPath.split("/").at(-1) ?? "";
    await expect(owner.page.getByRole("heading", { name: title, exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await owner.page.getByRole("link", { name: "编辑旅行", exact: true }).click();
    await owner.page.waitForURL((url) => url.pathname === `${tripPath}/edit`);
    await owner.page.getByLabel("可见性").selectOption({ label: "指定可见" });
    const grants = owner.page.locator("#trip-access-grants");
    await expect(grants).toBeVisible({ timeout: 30_000 });
    await grants.getByLabel("搜索可见成员").fill(EDITOR.email);
    const editorCheckbox = grants.getByRole("checkbox", {
      name: `选择可见成员 ${EDITOR.name}`,
      exact: true,
    });
    await expect(editorCheckbox).toBeVisible({ timeout: 30_000 });
    await editorCheckbox.check();
    await expect(
      grants.getByText("这趟旅行将对 0 个工作区、1 位成员可见。", {
        exact: true,
      }),
    ).toBeVisible();
    await shot(owner.page, "05-visibility-owner-grant-1440");
    await owner.page.getByRole("button", { name: "保存旅行", exact: true }).click();
    await owner.page.waitForURL((url) => url.pathname === tripPath, {
      timeout: 30_000,
    });
    await expect(owner.page.getByText("指定可见", { exact: true })).toBeVisible();

    const grantsResponse = await owner.page.request.get(`/v1/trips/${tripId}/access-grants`);
    expect(grantsResponse.status(), await grantsResponse.text()).toBe(200);
    const grantBody = (await grantsResponse.json()) as {
      resolved?: { users?: Array<{ label?: string }> };
    };
    expect(grantBody.resolved?.users?.some((entry) => entry.label === EDITOR.name)).toBe(true);

    const editor = await newPage(browser, editorState);
    try {
      await editor.page.goto(tripPath);
      await expect(editor.page.getByRole("heading", { name: title, exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(editor.page.getByText("指定可见", { exact: true })).toBeVisible();
      await editor.page.getByRole("link", { name: "编辑旅行", exact: true }).click();
      await editor.page.waitForURL((url) => url.pathname === `${tripPath}/edit`);
      const editedTitle = `${title} · Editor 已编辑`;
      await editor.page.getByLabel("旅行标题").fill(editedTitle);
      await expect(editor.page.getByText("正在读取可见范围…", { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(
        editor.page.getByRole("button", { name: "保存旅行", exact: true }),
      ).toBeEnabled();
      const update = editor.page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname === `/v1/trips/${tripId}`,
        { timeout: 60_000 },
      );
      await editor.page.getByRole("button", { name: "保存旅行", exact: true }).click();
      expect((await update).status()).toBe(200);
      await editor.page.waitForURL((url) => url.pathname === tripPath, {
        timeout: 30_000,
      });
      await expect(
        editor.page.getByRole("heading", { name: editedTitle, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await editor.page.reload();
      await expect(
        editor.page.getByRole("heading", { name: editedTitle, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await shot(editor.page, "05-visibility-editor-detail-1440");
      await editor.page.setViewportSize(MOBILE);
      await editor.page.reload();
      await expect(
        editor.page.getByRole("heading", { name: editedTitle, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(editor.page, "指定可见 Editor 390");
      await shot(editor.page, "05-visibility-editor-detail-390");

      const relogin = await playwrightRequest.newContext({
        baseURL: BASE,
        extraHTTPHeaders: { Origin: BASE },
      });
      try {
        await signIn(relogin, EDITOR);
        const reloginState = await stateOf(relogin);
        const reentered = await newPage(browser, reloginState);
        try {
          await reentered.page.goto(tripPath);
          await expect(
            reentered.page.getByRole("heading", {
              name: editedTitle,
              exact: true,
            }),
          ).toBeVisible({ timeout: 30_000 });
        } finally {
          await reentered.close();
        }
      } finally {
        await relogin.dispose();
      }
    } finally {
      await editor.close();
    }

    const viewer = await newPage(browser, viewerState);
    try {
      await viewer.page.goto(`/w/${WORKSPACE_SLUG}/trips`);
      const search = viewer.page.getByLabel("搜索旅行");
      await expect(search).toBeVisible({ timeout: 30_000 });
      await search.fill(title);
      await expect(viewer.page.getByText("没有匹配的旅行", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(viewer.page.getByText(title, { exact: true })).toHaveCount(0);

      const apiResponse = await viewer.page.request.get(`/v1/trips/${tripId}`);
      expect(apiResponse.status(), await apiResponse.text()).toBe(404);
      await viewer.page.goto(tripPath);
      await expect(
        viewer.page.getByRole("heading", { name: "找不到这趟旅行", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await viewer.page.reload();
      await expect(
        viewer.page.getByRole("heading", { name: "找不到这趟旅行", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await shot(viewer.page, "05-visibility-ungranted-404-1440");

      await viewer.page.goto(`/w/${WORKSPACE_SLUG}/activity`);
      await expect(viewer.page.getByRole("heading", { name: "活动流" })).toBeVisible({
        timeout: 30_000,
      });
      const scope = viewer.page.getByLabel("筛选活动范围");
      await expect(scope.locator("option", { hasText: title })).toHaveCount(0);
    } finally {
      await viewer.close();
    }
  } finally {
    await owner.close();
  }
});

test("通知与活动：Viewer 评论产生通知，单条/全部已读持久，活动含 Actor 与对象", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const viewer = await newPage(browser, viewerState);
  try {
    await viewer.page.goto(`/w/${WORKSPACE_SLUG}/journal`);
    await expect(viewer.page.getByRole("heading", { name: "全部日志" })).toBeVisible({
      timeout: 30_000,
    });
    await viewer.page.getByLabel("搜索日志").fill(ENTRY_TITLE);
    await viewer.page
      .getByRole("button", { name: new RegExp(escapeRegExp(ENTRY_TITLE), "u") })
      .click();
    const sheet = viewer.page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: ENTRY_TITLE, exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await sheet.getByLabel("评论内容").fill(FIRST_COMMENT);
    await sheet.getByRole("button", { name: "发送评论" }).click();
    await expect(sheet.getByText(FIRST_COMMENT, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const secondComment = await viewer.page.request.post("/v1/comments", {
      headers: { origin: BASE, "content-type": "application/json" },
      data: {
        targetType: "journal_entry",
        targetId: entryId,
        tripId: seedTripId,
        body: SECOND_COMMENT,
      },
    });
    expect(secondComment.status(), await secondComment.text()).toBe(201);
  } finally {
    await viewer.close();
  }

  const owner = await newPage(browser, ownerState);
  try {
    await owner.page.goto(`/w/${WORKSPACE_SLUG}/notifications`);
    await expect(owner.page.getByRole("heading", { name: "通知中心" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(owner.page.getByText(FIRST_COMMENT, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(owner.page.getByText(SECOND_COMMENT, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await shot(owner.page, "06-notifications-unread-1440");

    const firstRow = owner.page.getByText(FIRST_COMMENT, { exact: true }).locator("xpath=../..");
    const markOne = owner.page.waitForResponse(
      (response) =>
        /\/v1\/me\/notifications\/[^/]+\/read$/u.test(new URL(response.url()).pathname) &&
        response.request().method() === "PATCH",
    );
    await firstRow.getByRole("button", { name: "标为已读" }).click();
    expect((await markOne).status()).toBe(200);
    await expect(firstRow.getByRole("button", { name: "标为已读" })).toHaveCount(0);

    await owner.page.reload();
    const reloadedFirstRow = owner.page
      .getByText(FIRST_COMMENT, { exact: true })
      .locator("xpath=../..");
    await expect(reloadedFirstRow.getByRole("button", { name: "标为已读" })).toHaveCount(0);

    const markAll = owner.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/me/notifications/read-all" &&
        response.request().method() === "POST",
    );
    await owner.page.getByRole("button", { name: "全部标为已读" }).click();
    expect((await markAll).status()).toBe(200);
    await expect(owner.page.getByRole("button", { name: "全部已读" })).toBeDisabled();
    await owner.page.reload();
    await expect(owner.page.getByRole("button", { name: "全部已读" })).toBeDisabled({
      timeout: 30_000,
    });

    await owner.page.getByLabel("筛选通知类型").selectOption("mention");
    await expect(owner.page.getByText("没有匹配通知", { exact: true })).toBeVisible();
    await owner.page.getByLabel("筛选通知类型").selectOption("all");
    await shot(owner.page, "06-notifications-read-1440");
    await owner.page.setViewportSize(MOBILE);
    await expectNoOverflow(owner.page, "通知中心 390");
    await shot(owner.page, "06-notifications-read-390");

    await owner.page.goto(`/w/${WORKSPACE_SLUG}/activity`);
    await expect(owner.page.getByRole("heading", { name: "活动流" })).toBeVisible({
      timeout: 30_000,
    });
    const activity = owner.page
      .locator("article")
      .filter({ hasText: VIEWER.name })
      .filter({ hasText: "留下评论" })
      .first();
    await expect(activity).toBeVisible({ timeout: 30_000 });
    await expect(activity).toContainText("评论");
    await expect(activity).toContainText(SEED_TRIP_TITLE);
    await owner.page.reload();
    await expect(
      owner.page
        .locator("article")
        .filter({ hasText: VIEWER.name })
        .filter({ hasText: "留下评论" })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    await owner.page.getByLabel("筛选活动范围").selectOption(seedTripId);
    await expect(activity).toBeVisible();
    await shot(owner.page, "06-activity-1440");
    await owner.page.setViewportSize(MOBILE);
    await expectNoOverflow(owner.page, "活动流 390");
    await shot(owner.page, "06-activity-390");
  } finally {
    await owner.close();
  }
});

test("目的地搜索：腾讯候选可选，但保存旅行会被数据库约束阻断", async ({ browser }) => {
  test.setTimeout(480_000);
  const run = await newPage(browser, ownerState);
  run.page.on("requestfailed", (request) => {
    if (/map|maplibre|tiles/i.test(request.url())) {
      console.log(
        `P0_MAP_REQUEST_FAILED ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
      );
    }
  });
  run.page.on("console", (message) => {
    if (message.type() === "error" && /map|webgl|chunk/i.test(message.text())) {
      console.log(`P0_MAP_CONSOLE ${message.text()}`);
    }
  });
  try {
    await run.page.goto(`/w/${WORKSPACE_SLUG}/trips/new`);
    await expect(run.page.getByRole("heading", { name: "新建旅行" })).toBeVisible({
      timeout: 30_000,
    });
    const title = `P0 地图真实搜索 ${RUN_ID}`;
    await run.page.getByLabel("旅行标题").fill(title);

    const destinationSearch = run.page.getByRole("combobox", {
      name: "搜索目的地",
    });
    const destinationResponse = run.page.waitForResponse(
      (response) =>
        response.url().includes("/v1/places/search") &&
        response.request().method() === "GET" &&
        new URL(response.url()).searchParams.get("q") === "北京",
      { timeout: 90_000 },
    );
    await destinationSearch.fill("北京");
    const destinationHttp = await destinationResponse;
    expect(destinationHttp.status(), await destinationHttp.text()).toBe(200);
    const destinationBody = (await destinationHttp.json()) as {
      items: Array<{ name: string; countryCode?: string | null }>;
      degraded: boolean;
    };
    console.log(
      `P0_PLACES_DESTINATION ${JSON.stringify({
        url: destinationHttp.url(),
        body: destinationBody,
      })}`,
    );
    expect(destinationBody.items.length).toBeGreaterThan(0);
    const destinationList = run.page.getByRole("listbox", {
      name: "搜索目的地建议",
    });
    const beijingOption = destinationList.getByRole("option").filter({ hasText: "北京" }).first();
    await expect(beijingOption).toBeVisible({ timeout: 30_000 });
    await expect(beijingOption).toContainText("CN");
    await shot(run.page, "07-destination-search-1440");
    await beijingOption.click();
    const destinationRows = run.page.getByRole("list", {
      name: "已添加的目的地",
    });
    await expect(destinationRows.getByText("北京市", { exact: true }).first()).toBeVisible();

    const createTrip = run.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /^\/v1\/workspaces\/[^/]+\/trips$/u.test(new URL(response.url()).pathname),
    );
    await run.page.getByRole("button", { name: "创建旅行", exact: true }).click();
    const tripResponse = await createTrip;
    expect(tripResponse.status(), await tripResponse.text()).toBe(201);
    await run.page.waitForURL(
      (url) =>
        new RegExp(`^/w/${escapeRegExp(WORKSPACE_SLUG)}/trips/[0-9a-f-]{20,}$`, "u").test(
          url.pathname,
        ),
      { timeout: 30_000 },
    );
    const tripPath = new URL(run.page.url()).pathname;
    const tripId = tripPath.split("/").at(-1) ?? "";
    await expect(run.page.getByRole("heading", { name: title, exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await run.page.getByRole("tab", { name: "行程", exact: true }).click();
    const addButton = run.page.getByRole("button", { name: /添加(第一个)?节点/u }).first();
    await expect(addButton).toBeEnabled({ timeout: 30_000 });
    await addButton.click();
    const dialog = run.page.getByRole("dialog");
    await expect(dialog.getByText("添加行程节点", { exact: true })).toBeVisible();
    const stopSearch = dialog.getByRole("combobox", { name: "搜索地点" });
    const stopResponse = run.page.waitForResponse(
      (response) =>
        response.url().includes("/v1/places/search") &&
        response.request().method() === "GET" &&
        new URL(response.url()).searchParams.get("q") === "上海",
      { timeout: 90_000 },
    );
    await stopSearch.fill("上海");
    const stopHttp = await stopResponse;
    expect(stopHttp.status(), await stopHttp.text()).toBe(200);
    const stopBody = (await stopHttp.json()) as {
      items: Array<{
        name: string;
        country?: string | null;
        countryCode?: string | null;
      }>;
      degraded: boolean;
    };
    console.log(
      `P0_PLACES_STOP ${JSON.stringify({
        url: stopHttp.url(),
        body: stopBody,
      })}`,
    );
    expect(stopBody.items.length).toBeGreaterThan(0);
    const stopList = run.page.getByRole("listbox", {
      name: "搜索地点建议",
    });
    const shanghai = stopList.getByRole("option").filter({ hasText: "上海" }).first();
    await expect(shanghai).toBeVisible({ timeout: 30_000 });
    await shot(run.page, "07-stop-search-1440");
    await shanghai.click();
    await expect(dialog.getByLabel("城市", { exact: true })).not.toHaveValue("");
    await expect(dialog.getByLabel("纬度（可选）", { exact: true })).not.toHaveValue("");
    await expect(dialog.getByLabel("经度（可选）", { exact: true })).not.toHaveValue("");
    await dialog.getByLabel("开始日期", { exact: true }).fill(dateOnly(1));
    await dialog.getByLabel("结束日期", { exact: true }).fill(dateOnly(3));
    const saveStop = run.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/trips/${tripId}/stops`,
    );
    await dialog.getByRole("button", { name: "保存节点", exact: true }).click();
    expect((await saveStop).status()).toBe(201);
    await expect(dialog).toBeHidden();

    const stopsResponse = await run.page.request.get(`/v1/trips/${tripId}/stops`);
    expect(stopsResponse.status(), await stopsResponse.text()).toBe(200);
    const stops = (await stopsResponse.json()) as Array<{
      id: string;
      city: string;
      lat: number | null;
      lng: number | null;
    }>;
    expect(stops).toHaveLength(1);
    const stop = stops[0]!;
    expect(stop.city).toContain("上海");
    expect(stop.lat).not.toBeNull();
    expect(stop.lng).not.toBeNull();

    await run.page.goto(`${tripPath}/map`);
    await expect(run.page.getByRole("heading", { name: "行程地图", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(run.page.getByText(/ROUTE \/ 1 MAPPED STOPS/u)).toBeVisible();
    const sidebar = run.page.getByTestId("trip-map-sidebar");
    await expect(sidebar).toContainText("上海");
    await run.page.getByTestId(`trip-map-stop-${stop.id}`).click();
    await expect(run.page.getByTestId("trip-map-selected-stop")).toContainText(
      `${Number(stop.lat).toFixed(4)}, ${Number(stop.lng).toFixed(4)}`,
    );
    await expect(
      run.page
        .getByTestId("maplibre-canvas")
        .or(run.page.getByText("TILE FALLBACK / SCHEMATIC WORLD")),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      run.page
        .getByRole("button", { name: "选择停靠点 上海市" })
        .or(run.page.getByText("TILE FALLBACK / SCHEMATIC WORLD")),
    ).toBeVisible({ timeout: 30_000 });
    console.log(
      `P0_MAP_DOM ${JSON.stringify(
        await run.page.evaluate(() => {
          const host = document.querySelector('[data-testid="maplibre-canvas"]');
          const canvas = host?.querySelector("canvas");
          return {
            loader: host?.textContent?.includes("LOADING MAP TILES") ?? false,
            canvasCount: host?.querySelectorAll("canvas").length ?? 0,
            canvasBox: canvas
              ? {
                  width: canvas.getBoundingClientRect().width,
                  height: canvas.getBoundingClientRect().height,
                }
              : null,
          };
        }),
      )}`,
    );
    const mapRendered = await run.page.evaluate(() => {
      const host = document.querySelector('[data-testid="maplibre-canvas"]');
      return Boolean(
        host?.querySelector("canvas") ||
        document.body.textContent?.includes("TILE FALLBACK / SCHEMATIC WORLD"),
      );
    });
    await shot(run.page, "07-trip-map-1440");
    expect(
      mapRendered,
      "MapLibre worker/canvas or the schematic fallback must actually render",
    ).toBe(true);
    await run.page.reload();
    await expect(sidebar).toContainText("上海", { timeout: 30_000 });

    await run.page.setViewportSize(MOBILE);
    await run.page.reload();
    await expect(sidebar).toContainText("上海", { timeout: 30_000 });
    await expect(
      run.page
        .getByRole("button", { name: "选择停靠点 上海市" })
        .or(run.page.getByText("TILE FALLBACK / SCHEMATIC WORLD")),
    ).toBeVisible({ timeout: 30_000 });
    await expectNoOverflow(run.page, "行程地图 390");
    await shot(run.page, "07-trip-map-390");

    await run.page.setViewportSize(DESKTOP);
    await run.page.goto(`/w/${WORKSPACE_SLUG}/trips/${noStopsTripId}/map`);
    await expect(run.page.getByText("这趟旅行还没有停靠点", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await shot(run.page, "07-map-no-stops-1440");

    await run.page.goto(`/w/${WORKSPACE_SLUG}/trips/${unmappedTripId}/map`);
    await expect(run.page.getByText("停靠点还没有坐标", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(run.page.getByTestId("trip-map-sidebar")).toContainText("无坐标");
    await shot(run.page, "07-map-unmapped-1440");

    await run.page.goto(`/w/${WORKSPACE_SLUG}/trips/new`);
    await run.page.route("**/v1/places/search**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "Synthetic provider outage for acceptance error state.",
        }),
      });
    });
    const errorSearch = run.page.getByRole("combobox", {
      name: "搜索目的地",
    });
    await errorSearch.fill("兰州");
    const errorList = run.page.getByRole("listbox", {
      name: "搜索目的地建议",
    });
    await expect(errorList.getByRole("status")).toContainText("地点搜索暂时不可用", {
      timeout: 30_000,
    });
    await expect(errorList.getByRole("option", { name: /手动添加/u })).toBeVisible();
    await shot(run.page, "07-place-search-503-manual-1440");
  } finally {
    await run.page.unroute("**/v1/places/search**").catch(() => undefined);
    await run.close();
  }
});

test("停靠点搜索与地图：真实搜索、标记联动、无坐标/无停靠点空态与 390px", async ({ browser }) => {
  test.setTimeout(420_000);
  const title = `P0 停靠点地图 ${RUN_ID}`;
  const createdTrip = await ownerApi.post(`/v1/workspaces/${workspaceId}/trips`, {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      title,
      summary: "停靠点搜索与地图联动验收。",
      status: "upcoming",
      startDate: TRIP_START,
      endDate: TRIP_END,
      timeZone: "Asia/Shanghai",
      destinationsV2: [],
      tags: ["P0"],
      visibility: "workspace",
    },
  });
  expect(createdTrip.status(), await createdTrip.text()).toBe(201);
  const tripId = ((await createdTrip.json()) as { id: string }).id;
  const tripPath = `/w/${WORKSPACE_SLUG}/trips/${tripId}`;

  const run = await newPage(browser, ownerState);
  run.page.on("requestfailed", (request) => {
    if (/map|maplibre|tiles/i.test(request.url())) {
      console.log(
        `P0_MAP_REQUEST_FAILED ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
      );
    }
  });
  run.page.on("console", (message) => {
    if (message.type() === "error" && /map|webgl|chunk/i.test(message.text())) {
      console.log(`P0_MAP_CONSOLE ${message.text()}`);
    }
  });
  try {
    await run.page.goto(tripPath);
    await expect(run.page.getByRole("heading", { name: title, exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await run.page.getByRole("tab", { name: "行程", exact: true }).click();
    const addButton = run.page.getByRole("button", { name: /添加(第一个)?节点/u }).first();
    await expect(addButton).toBeEnabled({ timeout: 30_000 });
    await addButton.click();
    const dialog = run.page.getByRole("dialog");
    await expect(dialog.getByText("添加行程节点", { exact: true })).toBeVisible();
    const stopSearch = dialog.getByRole("combobox", { name: "搜索地点" });
    const stopResponse = run.page.waitForResponse(
      (response) =>
        response.url().includes("/v1/places/search") &&
        response.request().method() === "GET" &&
        new URL(response.url()).searchParams.get("q") === "上海",
      { timeout: 90_000 },
    );
    await stopSearch.fill("上海");
    const stopHttp = await stopResponse;
    expect(stopHttp.status(), await stopHttp.text()).toBe(200);
    const stopBody = (await stopHttp.json()) as {
      items: Array<{
        name: string;
        country?: string | null;
        countryCode?: string | null;
      }>;
      degraded: boolean;
    };
    console.log(
      `P0_PLACES_STOP ${JSON.stringify({
        url: stopHttp.url(),
        body: stopBody,
      })}`,
    );
    expect(stopBody.items.length).toBeGreaterThan(0);
    const stopList = run.page.getByRole("listbox", {
      name: "搜索地点建议",
    });
    const shanghai = stopList.getByRole("option").filter({ hasText: "上海" }).first();
    await expect(shanghai).toBeVisible({ timeout: 30_000 });
    await shot(run.page, "07-stop-search-1440");
    await shanghai.click();
    await expect(dialog.getByLabel("城市", { exact: true })).not.toHaveValue("");
    await expect(dialog.getByLabel("纬度（可选）", { exact: true })).not.toHaveValue("");
    await expect(dialog.getByLabel("经度（可选）", { exact: true })).not.toHaveValue("");
    await dialog.getByLabel("开始日期", { exact: true }).fill("2026-11-11");
    await dialog.getByLabel("结束日期", { exact: true }).fill("2026-11-12");
    const saveStop = run.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/v1/trips/${tripId}/stops`,
    );
    await dialog.getByRole("button", { name: "保存节点", exact: true }).click();
    expect((await saveStop).status()).toBe(201);
    await expect(dialog).toBeHidden();

    const stopsResponse = await run.page.request.get(`/v1/trips/${tripId}/stops`);
    expect(stopsResponse.status(), await stopsResponse.text()).toBe(200);
    const stops = (await stopsResponse.json()) as Array<{
      id: string;
      city: string;
      lat: number | null;
      lng: number | null;
    }>;
    expect(stops).toHaveLength(1);
    const stop = stops[0]!;
    expect(stop.city).toContain("上海");
    expect(stop.lat).not.toBeNull();
    expect(stop.lng).not.toBeNull();

    await run.page.goto(`${tripPath}/map`);
    await expect(run.page.getByRole("heading", { name: "行程地图", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(run.page.getByText(/ROUTE \/ 1 MAPPED STOPS/u)).toBeVisible();
    const sidebar = run.page.getByTestId("trip-map-sidebar");
    await expect(sidebar).toContainText("上海");
    await run.page.getByTestId(`trip-map-stop-${stop.id}`).click();
    await expect(run.page.getByTestId("trip-map-selected-stop")).toContainText(
      `${Number(stop.lat).toFixed(4)}, ${Number(stop.lng).toFixed(4)}`,
    );
    await expect(
      run.page
        .getByTestId("maplibre-canvas")
        .or(run.page.getByText("TILE FALLBACK / SCHEMATIC WORLD")),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      run.page
        .getByRole("button", { name: "选择停靠点 上海市" })
        .or(run.page.getByText("TILE FALLBACK / SCHEMATIC WORLD")),
    ).toBeVisible({ timeout: 30_000 });
    console.log(
      `P0_MAP_DOM ${JSON.stringify(
        await run.page.evaluate(() => {
          const host = document.querySelector('[data-testid="maplibre-canvas"]');
          const canvas = host?.querySelector("canvas");
          return {
            loader: host?.textContent?.includes("LOADING MAP TILES") ?? false,
            canvasCount: host?.querySelectorAll("canvas").length ?? 0,
            canvasBox: canvas
              ? {
                  width: canvas.getBoundingClientRect().width,
                  height: canvas.getBoundingClientRect().height,
                }
              : null,
          };
        }),
      )}`,
    );
    const mapRendered = await run.page.evaluate(() => {
      const host = document.querySelector('[data-testid="maplibre-canvas"]');
      return Boolean(
        host?.querySelector("canvas") ||
        document.body.textContent?.includes("TILE FALLBACK / SCHEMATIC WORLD"),
      );
    });
    await shot(run.page, "07-trip-map-1440");
    expect(
      mapRendered,
      "MapLibre worker/canvas or the schematic fallback must actually render",
    ).toBe(true);
    await run.page.reload();
    await expect(sidebar).toContainText("上海", { timeout: 30_000 });

    await run.page.setViewportSize(MOBILE);
    await run.page.reload();
    await expect(sidebar).toContainText("上海", { timeout: 30_000 });
    await expect(
      run.page
        .getByRole("button", { name: "选择停靠点 上海市" })
        .or(run.page.getByText("TILE FALLBACK / SCHEMATIC WORLD")),
    ).toBeVisible({ timeout: 30_000 });
    await expectNoOverflow(run.page, "行程地图 390");
    await shot(run.page, "07-trip-map-390");

    await run.page.setViewportSize(DESKTOP);
    await run.page.goto(`/w/${WORKSPACE_SLUG}/trips/${noStopsTripId}/map`);
    await expect(run.page.getByText("这趟旅行还没有停靠点", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await shot(run.page, "07-map-no-stops-1440");

    await run.page.goto(`/w/${WORKSPACE_SLUG}/trips/${unmappedTripId}/map`);
    await expect(run.page.getByText("停靠点还没有坐标", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(run.page.getByTestId("trip-map-sidebar")).toContainText("无坐标");
    await shot(run.page, "07-map-unmapped-1440");

    await run.page.goto(tripPath);
    await run.page.getByRole("tab", { name: "行程", exact: true }).click();
    await expect(run.page.getByRole("button", { name: "添加节点", exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    await run.page.getByRole("button", { name: "添加节点", exact: true }).click();
    await run.page.route("**/v1/places/search**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "Synthetic provider outage for acceptance error state.",
        }),
      });
    });
    const errorSearch = run.page.getByRole("dialog").getByRole("combobox", { name: "搜索地点" });
    await errorSearch.fill("兰州");
    const errorList = run.page.getByRole("listbox", {
      name: "搜索地点建议",
    });
    await expect(errorList.getByRole("status")).toContainText("地点搜索暂时不可用", {
      timeout: 30_000,
    });
    await expect(errorList.getByRole("option", { name: /使用「兰州」作为城市/u })).toBeVisible();
    await shot(run.page, "07-place-search-503-manual-1440");
  } finally {
    await run.page.unroute("**/v1/places/search**").catch(() => undefined);
    await run.close();
  }
});

test("洞察页：真实支出聚合、分类、预算与空工作区空态", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, close } = await newPage(browser, ownerState);
  try {
    await page.goto(`/w/${WORKSPACE_SLUG}/insights`);
    await expect(page.getByRole("heading", { name: "旅行洞察", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("旅行次数", { exact: true })).toBeVisible();
    await expect(page.getByText("总支出", { exact: true })).toBeVisible();
    await expect(page.getByText(/¥\s?55\.55/u).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("2 笔 CNY 明细", { exact: true })).toBeVisible();
    await expect(page.getByText("餐饮", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("交通", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(SEED_TRIP_TITLE, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/LAST 12 MONTHS · ¥\s?55\.55/u)).toBeVisible();
    await expect(page.getByText(/3%/u).first()).toBeVisible();
    await shot(page, "08-insights-1440");

    await page.setViewportSize(MOBILE);
    await expectNoOverflow(page, "洞察 390");
    await shot(page, "08-insights-390");

    await page.goto(`/w/${EMPTY_WORKSPACE_SLUG}/insights`);
    await expect(page.getByRole("heading", { name: "旅行洞察", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("还没有足够的旅行数据", { exact: true })).toBeVisible();
    await shot(page, "08-insights-empty-1440");
  } finally {
    await close();
  }
});

test("登录设备：同设备重复登录合并一行，退出其他设备后仅当前会话保留", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: DESKTOP,
    extraHTTPHeaders: { Origin: BASE },
  });
  const page = await context.newPage();
  try {
    await loginThroughUi(page, SECURITY);

    for (let index = 0; index < 2; index += 1) {
      const response = await postWithRetry(page.request, "/v1/auth/sign-in/email", {
        email: SECURITY.email,
        password: SECURITY.password,
        rememberMe: true,
      });
      expect(response.status(), await response.text()).toBe(200);
      const device = await page.request.post("/v1/me/device", {
        headers: { origin: BASE },
      });
      expect(device.status(), await device.text()).toBe(200);
    }

    await page.goto(`/w/${WORKSPACE_SLUG}/settings/security`);
    await expect(page.getByRole("heading", { name: "账号安全", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    const devices = page.locator('section[aria-label="登录设备"]');
    await expect(devices.getByText(/共 1 台设备 · 3 个有效会话/u)).toBeVisible({
      timeout: 30_000,
    });
    const rows = devices.locator("ul > li");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("当前设备");
    await expect(rows.first()).toContainText("3 次登录");
    const labels = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? ""),
    );
    expect(new Set(labels).size).toBe(labels.length);
    await shot(page, "09-devices-deduped-1440");

    const otherContext = await browser.newContext({
      baseURL: BASE,
      viewport: DESKTOP,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      extraHTTPHeaders: { Origin: BASE },
    });
    try {
      const signInResponse = await postWithRetry(otherContext.request, "/v1/auth/sign-in/email", {
        email: SECURITY.email,
        password: SECURITY.password,
        rememberMe: true,
      });
      expect(signInResponse.status(), await signInResponse.text()).toBe(200);
      const device = await otherContext.request.post("/v1/me/device", {
        headers: { origin: BASE },
      });
      expect(device.status(), await device.text()).toBe(200);

      await page.reload();
      await expect(
        page.locator('section[aria-label="登录设备"]').getByText(/共 2 台设备/u),
      ).toBeVisible({ timeout: 30_000 });
      const revokeOthers = page.getByRole("button", {
        name: "退出所有其他设备",
      });
      await expect(revokeOthers).toBeEnabled();
      const revokeOthersResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/auth/revoke-other-sessions" &&
          response.request().method() === "POST",
      );
      await revokeOthers.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "退出所有其他设备？" })).toBeVisible();
      await dialog.getByRole("button", { name: "退出所有其他设备" }).click();
      expect((await revokeOthersResponse).status()).toBe(200);
      await expect(page.getByText("已退出所有其他设备，当前设备保持登录。")).toBeVisible({
        timeout: 30_000,
      });
      const otherMe = await otherContext.request.get("/v1/me");
      expect(otherMe.status()).toBe(401);
      const currentMe = await page.request.get("/v1/me");
      expect(currentMe.status(), await currentMe.text()).toBe(200);
    } finally {
      await otherContext.close();
    }

    const passwordForm = page.locator("form", {
      has: page.getByRole("heading", { name: "修改密码" }),
    });
    await passwordForm.getByLabel(/^当前密码/).fill(WRONG_PASSWORD);
    await passwordForm.getByLabel(/^新密码/).fill("Another-P0-Pass-Aa1!");
    await passwordForm.getByLabel(/^确认新密码/).fill("Another-P0-Pass-Aa1!");
    const failedChange = page.waitForResponse((response) =>
      response.url().includes("/v1/auth/change-password"),
    );
    await passwordForm.getByRole("button", { name: "修改密码" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("确认修改密码？")).toBeVisible();
    await confirm.getByRole("button", { name: "确认修改密码" }).click();
    expect((await failedChange).status()).toBe(400);
    await expect(page.getByText("当前密码不正确，密码没有修改。")).toBeVisible();

    await shot(page, "09-security-1440");
    await page.setViewportSize(MOBILE);
    await expectNoOverflow(page, "账号安全 390");
    await shot(page, "09-security-390");
  } finally {
    await context.close();
  }
});
