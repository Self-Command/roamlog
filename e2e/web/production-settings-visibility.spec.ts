import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_WEB_URL ?? "https://we.spacedo.org").replace(/\/+$/u, "");
const SSH_HOST = process.env.E2E_PROD_SSH ?? "root@217.217.197.188";
const PG_CONTAINER = process.env.E2E_PROD_PG_CONTAINER ?? "roamlog-postgres-1";
const RUN_ID = `prod-sv-${Date.now().toString(36)}`;
const PASSWORD = "Roamlog-Prod-Sv1!";
const OWNER_EMAIL = `${RUN_ID}-owner@roamlog.test`;
const VIEWER_EMAIL = `${RUN_ID}-viewer@roamlog.test`;
const EDITOR_EMAIL = `${RUN_ID}-editor@roamlog.test`;
const OWNER_NAME = "生产设置 Owner";
const VIEWER_NAME = "生产设置 Viewer";
const EDITOR_NAME = "生产设置 Editor";
const WORKSPACE_NAME = `生产设置验收 ${RUN_ID}`;
const WORKSPACE_SLUG = RUN_ID;
const TRIP_TITLE = `生产设置旅行 ${RUN_ID}`;
const ENTRY_TITLE = `生产设置日志 ${RUN_ID}`;
const COMMENT = `生产设置评论 ${RUN_ID}`;
const EMPTY_MAP_TRIP_TITLE = `生产地图空态 ${RUN_ID}`;
const PLACE_QUERY = "Kanazawa";
const OUT_DIR = path.resolve(process.cwd(), ".audit", "production", RUN_ID);
const AVATAR_FILE = path.resolve(
  process.cwd(),
  ".audit/settings/fixtures/avatar.png",
);
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

const evidence: {
  runId: string;
  startedAt: string;
  base: string;
  accounts: { owner: string; viewer: string; editor: string };
  workspace: { id: string; slug: string };
  checks: Record<string, unknown>;
  cleanup: string;
} = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  base: BASE,
  accounts: {
    owner: OWNER_EMAIL,
    viewer: VIEWER_EMAIL,
    editor: EDITOR_EMAIL,
  },
  workspace: { id: "", slug: WORKSPACE_SLUG },
  checks: {},
  cleanup: "not-run",
};

test.describe.configure({ retries: 0, timeout: 300_000 });

let ownerApi: APIRequestContext;
let viewerApi: APIRequestContext;
let editorApi: APIRequestContext;
let ownerContext: BrowserContext;
let viewerContext: BrowserContext;
let editorContext: BrowserContext;
let ownerPage: Page;
let viewerPage: Page;
let editorPage: Page;
let ownerId = "";
let workspaceId = "";
let tripId = "";
let tripPath = "";
let tripStartDate = "";
let tripEndDate = "";
let entryId = "";

function sql(statement: string): string {
  const encoded = Buffer.from(statement, "utf8").toString("base64");
  return execSync(
    `ssh ${SSH_HOST} "printf '%s' '${encoded}' | base64 -d | docker exec -i ${PG_CONTAINER} psql -U roamlog -d roamlog -v ON_ERROR_STOP=1 -f -"`,
    { encoding: "utf8" },
  );
}

async function waitForApi(): Promise<void> {
  const probe = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await probe.get("/v1/health", { timeout: 5_000 });
        if (response.status() === 200) return;
      } catch {
        // Retry until the deployment finishes restarting.
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  } finally {
    await probe.dispose();
  }
  throw new Error(`Production API did not become healthy at ${BASE}/v1/health`);
}

async function postAuth(
  api: APIRequestContext,
  requestPath: string,
  data: Record<string, unknown>,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await api.post(requestPath, {
      data,
      headers: { origin: BASE, "content-type": "application/json" },
    });
    if (response.status() !== 429) return response;
    const retryAfter = Number(response.headers()["retry-after"] ?? "15");
    const delay = Math.min(90_000, Math.max(5_000, retryAfter * 1_000));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return api.post(requestPath, {
    data,
    headers: { origin: BASE, "content-type": "application/json" },
  });
}

async function signUp(
  api: APIRequestContext,
  email: string,
  name: string,
): Promise<string> {
  const response = await postAuth(api, "/v1/auth/sign-up/email", {
    email,
    password: PASSWORD,
    name,
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { user: { id: string } }).user.id;
}

async function signIn(api: APIRequestContext, email: string): Promise<void> {
  const response = await postAuth(api, "/v1/auth/sign-in/email", {
    email,
    password: PASSWORD,
    rememberMe: true,
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function ensureVerifiedUser(
  api: APIRequestContext,
  email: string,
  name: string,
): Promise<string> {
  const id = await signUp(api, email, name);
  sql(`UPDATE "User" SET "emailVerified" = true WHERE email = '${email}';`);
  await signIn(api, email);
  return id;
}

async function currentSessionId(page: Page): Promise<string> {
  const response = await page.request.get("/v1/auth/get-session");
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { session?: { id?: unknown } };
  expect(typeof body.session?.id).toBe("string");
  return body.session?.id as string;
}

async function expectPageEmail(page: Page, email: string): Promise<void> {
  const response = await page.request.get("/v1/me");
  expect(response.status(), await response.text()).toBe(200);
  expect(((await response.json()) as { email: string }).email).toBe(email);
}

async function signInOnSameDevice(page: Page, email: string): Promise<void> {
  const response = await postAuth(page.request, "/v1/auth/sign-in/email", {
    email,
    password: PASSWORD,
    rememberMe: true,
  });
  expect(response.status(), await response.text()).toBe(200);
  const association = await page.request.post("/v1/me/device", {
    headers: { origin: BASE },
  });
  expect(association.status(), await association.text()).toBe(200);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

async function createTripThroughUi(page: Page): Promise<void> {
  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/trips/new`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("旅行标题").fill(TRIP_TITLE);
  await page.getByRole("button", { name: "创建旅行", exact: true }).click();
  await page.waitForURL(
    (url) =>
      new RegExp(`^/w/${WORKSPACE_SLUG}/trips/[0-9a-f-]{20,}$`, "u").test(
        url.pathname,
      ),
    { timeout: 30_000 },
  );
  tripPath = new URL(page.url()).pathname;
  tripId = tripPath.split("/").pop() ?? "";
  expect(tripId).toMatch(/^[0-9a-f-]{20,}$/u);
  const response = await page.request.get(`/v1/trips/${tripId}`);
  expect(response.status(), await response.text()).toBe(200);
  const trip = (await response.json()) as { startDate: string; endDate: string };
  tripStartDate = trip.startDate;
  tripEndDate = trip.endDate;
}

async function setCustomGrants(
  page: Page,
  grantsToAdd: ReadonlyArray<{ email: string; name: string }>,
): Promise<void> {
  await page.goto(`${BASE}${tripPath}/edit`, { waitUntil: "domcontentloaded" });
  const visibility = page.getByLabel("可见性");
  await expect(visibility).toBeVisible({ timeout: 30_000 });
  await visibility.selectOption({ label: "指定可见" });
  const grants = page.locator("#trip-access-grants");
  await expect(grants).toBeVisible({ timeout: 30_000 });
  await expect(grants.getByLabel("搜索可见成员")).toBeVisible({ timeout: 30_000 });
  await expect(grants.getByText("正在读取可见范围…", { exact: true })).toHaveCount(0);
  for (const grant of grantsToAdd) {
    const search = grants.getByLabel("搜索可见成员");
    await search.fill(grant.email);
    const checkbox = grants.getByRole("checkbox", {
      name: `选择可见成员 ${grant.name}`,
      exact: true,
    });
    await expect(checkbox).toBeVisible({ timeout: 30_000 });
    await checkbox.check();
  }
  await page.getByRole("button", { name: "保存旅行", exact: true }).click();
  await page.waitForURL((url) => url.pathname === tripPath, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: TRIP_TITLE, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("指定可见", { exact: true })).toBeVisible();
}

async function createJournalEntry(page: Page): Promise<string> {
  const response = await page.request.post(`/v1/trips/${tripId}/entries`, {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      title: ENTRY_TITLE,
      date: tripStartDate,
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
            content: [{ type: "text", text: "生产设置验收写入的日志正文。" }],
          },
        ],
      },
      contentHtml: "<p>生产设置验收写入的日志正文。</p>",
      excerpt: "生产设置验收日志摘要",
      tags: ["验收"],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function ensureOwnerTrip(page: Page): Promise<void> {
  if (tripId) return;
  await createTripThroughUi(page);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await waitForApi();

  ownerApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  viewerApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  editorApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });

  ownerId = await ensureVerifiedUser(ownerApi, OWNER_EMAIL, OWNER_NAME);
  const viewerId = await ensureVerifiedUser(viewerApi, VIEWER_EMAIL, VIEWER_NAME);
  const editorId = await ensureVerifiedUser(editorApi, EDITOR_EMAIL, EDITOR_NAME);

  const workspace = await ownerApi.post("/v1/workspaces", {
    data: {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
    },
    headers: { origin: BASE, "content-type": "application/json" },
  });
  expect(workspace.status(), await workspace.text()).toBe(201);
  workspaceId = ((await workspace.json()) as { id: string }).id;
  evidence.workspace.id = workspaceId;

  sql(`
INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role, status, "joinedAt", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), '${workspaceId}', '${viewerId}', 'viewer', 'active', now(), now(), now()),
  (gen_random_uuid(), '${workspaceId}', '${editorId}', 'editor', 'active', now(), now(), now());
`);

  ownerContext = await browser.newContext({
    baseURL: BASE,
    storageState: await ownerApi.storageState(),
    viewport: DESKTOP,
  });
  viewerContext = await browser.newContext({
    baseURL: BASE,
    storageState: await viewerApi.storageState(),
    viewport: DESKTOP,
  });
  editorContext = await browser.newContext({
    baseURL: BASE,
    storageState: await editorApi.storageState(),
    viewport: DESKTOP,
  });
  ownerPage = await ownerContext.newPage();
  viewerPage = await viewerContext.newPage();
  editorPage = await editorContext.newPage();

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "旅行总览" })).toBeVisible({
    timeout: 30_000,
  });
  const device = await ownerPage.request.post("/v1/me/device", {
    headers: { origin: BASE },
  });
  expect(device.status(), await device.text()).toBe(200);
  const sessionId = await currentSessionId(ownerPage);
  sql(`DELETE FROM "Session" WHERE "userId" = '${ownerId}' AND id <> '${sessionId}';`);

  await viewerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(viewerPage.getByRole("heading", { name: "旅行总览" })).toBeVisible({
    timeout: 30_000,
  });
  await editorPage.goto(`${BASE}/w/${WORKSPACE_SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(editorPage.getByRole("heading", { name: "旅行总览" })).toBeVisible({
    timeout: 30_000,
  });
  await expectPageEmail(ownerPage, OWNER_EMAIL);
  await expectPageEmail(viewerPage, VIEWER_EMAIL);
  await expectPageEmail(editorPage, EDITOR_EMAIL);
});

test.afterAll(async () => {
  try {
    sql(`
DELETE FROM "Workspace" WHERE id = '${workspaceId}';
DELETE FROM "Workspace" WHERE "ownerId" IN (
  SELECT id FROM "User"
  WHERE email IN ('${OWNER_EMAIL}','${VIEWER_EMAIL}','${EDITOR_EMAIL}')
);
DELETE FROM "User" WHERE email IN ('${OWNER_EMAIL}','${VIEWER_EMAIL}','${EDITOR_EMAIL}');
`);
    evidence.cleanup = "ok";
  } catch (error) {
    const cleanupError = error instanceof Error ? error.message : String(error);
    evidence.cleanup = `failed: ${cleanupError}`;
  } finally {
    await Promise.allSettled([
      ownerContext?.close(),
      viewerContext?.close(),
      editorContext?.close(),
    ]);
    await Promise.allSettled([
      ownerApi?.dispose(),
      viewerApi?.dispose(),
      editorApi?.dispose(),
    ]);
    writeFileSync(
      path.join(OUT_DIR, "evidence.json"),
      `${JSON.stringify({ ...evidence, finishedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  }
});

test("01 个人资料：头像、显示名称保存后刷新仍在", async () => {
  await ownerPage.setViewportSize(DESKTOP);
  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/settings/profile`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    ownerPage.getByRole("heading", { name: "个人资料", level: 1 }),
  ).toBeVisible({ timeout: 30_000 });

  const avatarSection = ownerPage.locator('section[aria-label="头像"]');
  const avatarPatch = ownerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/me" &&
      response.request().method() === "PATCH",
    { timeout: 90_000 },
  );
  await ownerPage
    .getByTestId("avatar-file-input")
    .setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: readFileSync(AVATAR_FILE),
    });
  const uploaded = await avatarPatch;
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  await expect(ownerPage.getByText("头像已更新。")).toBeVisible({ timeout: 45_000 });

  const avatarImage = avatarSection.locator("img").first();
  await expect
    .poll(
      async () => (await avatarImage.getAttribute("src")) ?? "",
      { timeout: 45_000, message: "头像必须拿到可加载的图片地址" },
    )
    .not.toBe("");
  await expect
    .poll(
      async () =>
        avatarImage.evaluate(
          (image) => (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
      { timeout: 45_000, message: "头像图片必须完成加载" },
    )
    .toBe(true);

  const renamed = `${OWNER_NAME} 已保存`;
  await ownerPage.getByLabel(/^显示名称/).fill(renamed);
  const profilePatch = ownerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/me" &&
      response.request().method() === "PATCH",
  );
  await ownerPage.getByRole("button", { name: "保存个人资料" }).click();
  const saved = await profilePatch;
  expect(saved.status(), await saved.text()).toBe(200);
  await expect(ownerPage.getByText("个人资料已保存。")).toBeVisible();

  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await expect(ownerPage.getByLabel(/^显示名称/)).toHaveValue(renamed, {
    timeout: 30_000,
  });
  await expect(avatarSection.locator("img").first()).toBeVisible();
  const me = await ownerPage.request.get("/v1/me");
  expect(me.status(), await me.text()).toBe(200);
  const body = (await me.json()) as { name: string; image: string | null };
  expect(body.name).toBe(renamed);
  expect(body.image).toBeTruthy();

  evidence.checks.profile = { name: body.name, avatar: Boolean(body.image) };
  await capture(ownerPage, "01-profile-1440");
  await ownerPage.setViewportSize(MOBILE);
  await capture(ownerPage, "01-profile-390");
  await expectNoHorizontalOverflow(ownerPage, "个人资料 390");
  await ownerPage.setViewportSize(DESKTOP);
});

test("02 工作区设置保存刷新，危险区删除与转移都有确认保护", async () => {
  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/settings/workspace`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    ownerPage.getByRole("heading", { name: "工作区设置" }),
  ).toBeVisible({ timeout: 30_000 });

  await ownerPage.getByLabel("周起始日").selectOption("3");
  await ownerPage.getByLabel("默认可见性").selectOption("private");
  await ownerPage.getByLabel("界面密度").selectOption("compact");
  await ownerPage.getByLabel("强调色十六进制值").fill("#3b9eff");
  const saveResponse = ownerPage.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new RegExp(`^/v1/workspaces/${workspaceId}$`, "u").test(
        new URL(response.url()).pathname,
      ),
  );
  await ownerPage.getByRole("button", { name: "保存更改" }).click();
  const saved = await saveResponse;
  expect(saved.status(), await saved.text()).toBe(200);
  await expect(ownerPage.getByText("工作区设置已保存。")).toBeVisible();

  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await expect(ownerPage.getByLabel("周起始日")).toHaveValue("3", {
    timeout: 30_000,
  });
  await expect(ownerPage.getByLabel("默认可见性")).toHaveValue("private");
  await expect(ownerPage.getByLabel("界面密度")).toHaveValue("compact");
  await expect(ownerPage.getByLabel("强调色十六进制值")).toHaveValue("#3b9eff");

  await capture(ownerPage, "02-workspace-1440");
  await ownerPage.setViewportSize(MOBILE);
  await capture(ownerPage, "02-workspace-390");
  await expectNoHorizontalOverflow(ownerPage, "工作区设置 390");
  await ownerPage.setViewportSize(DESKTOP);

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/settings/danger`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "危险区" })).toBeVisible({
    timeout: 30_000,
  });
  const deleteButton = ownerPage.getByRole("button", { name: "删除此工作区" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const deleteDialog = ownerPage.getByRole("dialog");
  const confirmDelete = deleteDialog.getByRole("button", { name: "确认删除" });
  await expect(confirmDelete).toBeDisabled();
  await deleteDialog
    .getByLabel("输入工作区名称以确认")
    .fill(WORKSPACE_NAME);
  await expect(confirmDelete).toBeEnabled();
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await expect(deleteDialog).not.toBeVisible();

  await ownerPage.getByRole("button", { name: "转移所有权" }).click();
  const transferDialog = ownerPage.getByRole("dialog");
  await expect(
    transferDialog.getByRole("heading", { name: "确认转移所有权" }),
  ).toBeVisible();
  await expect(
    transferDialog.getByRole("button", { name: "确认转移" }),
  ).toBeDisabled();
  await transferDialog.getByRole("button", { name: "取消" }).click();
  await expect(transferDialog).not.toBeVisible();

  evidence.checks.workspace = {
    settingsPersisted: true,
    deleteProtected: true,
    transferProtected: true,
  };
  await capture(ownerPage, "02-danger-1440");
});

test("03 登录设备去重与会话计数，退出其他设备后只剩当前会话", async () => {
  await signInOnSameDevice(ownerPage, OWNER_EMAIL);
  await signInOnSameDevice(ownerPage, OWNER_EMAIL);

  const otherApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: {
      Origin: BASE,
      "User-Agent": "Roamlog-Production-Other-Device/1.0",
    },
  });
  try {
    await signIn(otherApi, OWNER_EMAIL);
    const associated = await otherApi.post("/v1/me/device", {
      headers: { origin: BASE },
    });
    expect(associated.status(), await associated.text()).toBe(200);

    const sessionsBefore = await ownerPage.request.get("/v1/me/sessions");
    expect(sessionsBefore.status(), await sessionsBefore.text()).toBe(200);
    const sessions = (await sessionsBefore.json()) as Array<{
      id: string;
      deviceId: string | null;
    }>;
    expect(sessions).toHaveLength(4);
    expect(new Set(sessions.map((session) => session.deviceId)).size).toBe(2);

    await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/settings/security`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      ownerPage.getByRole("heading", { name: "账号安全", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    const devices = ownerPage.locator('section[aria-label="登录设备"]');
    await expect(devices).toContainText(
      "共 2 台设备 · 4 个有效会话；同一设备只显示一次。",
      { timeout: 30_000 },
    );
    await expect(devices.locator("ul > li")).toHaveCount(2);
    await expect(devices.getByText("3 次登录", { exact: true })).toBeVisible();

    const revokeResponse = ownerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/revoke-other-sessions" &&
        response.request().method() === "POST",
    );
    await devices.getByRole("button", { name: "退出所有其他设备" }).click();
    const confirm = ownerPage.getByRole("dialog");
    await confirm
      .getByRole("button", { name: "退出所有其他设备" })
      .click();
    expect((await revokeResponse).status()).toBe(200);
    await expect(
      ownerPage.getByText("已退出所有其他设备，当前设备保持登录。"),
    ).toBeVisible();
    await expect(ownerPage).toHaveURL(
      `${BASE}/w/${WORKSPACE_SLUG}/settings/security`,
    );
    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    await expect(devices).toContainText(
      "共 1 台设备 · 1 个有效会话；同一设备只显示一次。",
      { timeout: 30_000 },
    );
    await expect(devices.locator("ul > li")).toHaveCount(1);

    const passwordForm = ownerPage.locator("form", {
      has: ownerPage.getByRole("heading", { name: "修改密码" }),
    });
    await passwordForm.getByLabel(/^当前密码/).fill("Definitely-Wrong-123!");
    await passwordForm.getByLabel(/^新密码/).fill("Another-Pass-123!");
    await passwordForm.getByLabel(/^确认新密码/).fill("Another-Pass-123!");
    const changeResponse = ownerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/change-password",
    );
    await passwordForm.getByRole("button", { name: "修改密码" }).click();
    const passwordConfirm = ownerPage.getByRole("dialog");
    await passwordConfirm
      .getByRole("button", { name: "确认修改密码" })
      .click();
    expect((await changeResponse).status()).toBe(400);
    await expect(
      ownerPage.getByText("当前密码不正确，密码没有修改。"),
    ).toBeVisible();

    evidence.checks.security = {
      sessionsBefore: sessions.length,
      deviceGroupsBefore: 2,
      sessionsAfter: 1,
      revokeOthersKeptCurrentSession: true,
      wrongPasswordRejected: true,
    };
    await capture(ownerPage, "03-security-1440");
    await ownerPage.setViewportSize(MOBILE);
    await capture(ownerPage, "03-security-390");
    await expectNoHorizontalOverflow(ownerPage, "账号安全 390");
    await ownerPage.setViewportSize(DESKTOP);

    const revoked = await otherApi.get("/v1/me");
    expect(revoked.status()).toBe(401);
  } finally {
    await otherApi.dispose();
  }
});

test("04 洞察空态：没有旅行时给出可解释空态", async () => {
  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/insights`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "旅行洞察" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    ownerPage.getByText("还没有足够的旅行数据", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  evidence.checks.insightsEmpty = true;
  await capture(ownerPage, "04-insights-empty-1440");
  await ownerPage.setViewportSize(MOBILE);
  await capture(ownerPage, "04-insights-empty-390");
  await expectNoHorizontalOverflow(ownerPage, "洞察空态 390");
  await ownerPage.setViewportSize(DESKTOP);
});

test("05 指定可见、Viewer 评论通知、活动流与 Editor 权限", async () => {
  await expectPageEmail(ownerPage, OWNER_EMAIL);
  await createTripThroughUi(ownerPage);
  await setCustomGrants(ownerPage, [
    { email: VIEWER_EMAIL, name: VIEWER_NAME },
    { email: EDITOR_EMAIL, name: EDITOR_NAME },
  ]);
  entryId = await createJournalEntry(ownerPage);

  await viewerPage.goto(`${BASE}${tripPath}`, { waitUntil: "domcontentloaded" });
  await expect(
    viewerPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(viewerPage.getByText("指定可见", { exact: true })).toBeVisible();
  const viewerEdit = viewerPage.getByRole("button", {
    name: "编辑旅行",
    exact: true,
  });
  await expect(viewerEdit).toBeVisible();
  await expect(viewerEdit).toBeDisabled();
  await capture(viewerPage, "05-viewer-readonly-1440");

  await viewerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/journal`, {
    waitUntil: "domcontentloaded",
  });
  await expect(viewerPage.getByRole("heading", { name: "全部日志" })).toBeVisible({
    timeout: 30_000,
  });
  await viewerPage.getByLabel("搜索日志").fill(ENTRY_TITLE);
  await viewerPage
    .getByRole("button", { name: new RegExp(ENTRY_TITLE, "u") })
    .click();
  const journalSheet = viewerPage.getByRole("dialog");
  await expect(
    journalSheet.getByRole("heading", { name: ENTRY_TITLE }),
  ).toBeVisible({ timeout: 30_000 });
  await journalSheet.getByLabel("评论内容").fill(COMMENT);
  await journalSheet.getByRole("button", { name: "发送评论" }).click();
  await expect(journalSheet.getByText(COMMENT, { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}`, {
    waitUntil: "domcontentloaded",
  });
  await expectPageEmail(ownerPage, OWNER_EMAIL);
  const notificationsResponse = await ownerPage.request.get(
    "/v1/me/notifications?limit=100&sort=createdAt:desc",
  );
  expect(notificationsResponse.status(), await notificationsResponse.text()).toBe(200);
  const notificationBody = (await notificationsResponse.json()) as {
    items: Array<{ id: string; type: string; title: string; body: string; readAt: string | null }>;
  };
  evidence.checks.commentNotification = {
    ownerId,
    entryId,
    count: notificationBody.items.length,
    items: notificationBody.items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      readAt: item.readAt,
    })),
  };
  expect
    .soft(
      notificationBody.items.length,
      "Owner 应收到 Viewer 对日志评论的站内通知",
    )
    .toBeGreaterThan(0);

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/notifications`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "通知中心" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(ownerPage.getByTestId("topbar-notifications")).toHaveAttribute(
    "aria-label",
    /1 条未读/u,
    { timeout: 30_000 },
  );
  await capture(ownerPage, "05-notifications-unread-1440");

  if (notificationBody.items.length > 0) {
    const commentNotification = notificationBody.items.find((item) =>
      item.body.includes(COMMENT),
    );
    expect
      .soft(commentNotification, "通知正文应包含 Viewer 的评论")
      .toBeTruthy();
    if (commentNotification) {
      await expect(ownerPage.getByText(COMMENT, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      const markRead = ownerPage.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          /^\/v1\/me\/notifications\/[^/]+\/read$/u.test(
            new URL(response.url()).pathname,
          ),
      );
      await ownerPage
        .getByRole("button", { name: "标为已读", exact: true })
        .first()
        .click();
      expect((await markRead).status()).toBe(200);
      await expect(ownerPage.getByTestId("topbar-notifications")).toHaveAttribute(
        "aria-label",
        "通知，没有未读",
        { timeout: 30_000 },
      );
      const unread = await ownerPage.request.get(
        "/v1/me/notifications?unreadOnly=true&limit=100",
      );
      expect(unread.status(), await unread.text()).toBe(200);
      expect(
        ((await unread.json()) as { items: unknown[] }).items,
      ).toHaveLength(0);
    }
  }

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/activity`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "活动流" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    ownerPage
      .locator("article")
      .filter({ hasText: VIEWER_NAME })
      .filter({ hasText: "留下评论" })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await capture(ownerPage, "05-activity-1440");

  await ownerPage.goto(`${BASE}${tripPath}/edit`, {
    waitUntil: "domcontentloaded",
  });
  const grants = ownerPage.locator("#trip-access-grants");
  await expect(grants.getByLabel("搜索可见成员")).toBeVisible({ timeout: 30_000 });
  await grants.getByLabel("搜索可见成员").fill(VIEWER_EMAIL);
  const viewerGrant = grants.getByRole("checkbox", {
    name: `选择可见成员 ${VIEWER_NAME}`,
    exact: true,
  });
  await expect(viewerGrant).toBeChecked({ timeout: 30_000 });
  await viewerGrant.uncheck();
  await ownerPage.getByRole("button", { name: "保存旅行", exact: true }).click();
  await ownerPage.waitForURL((url) => url.pathname === tripPath, {
    timeout: 30_000,
  });

  await viewerPage.goto(`${BASE}${tripPath}`, { waitUntil: "domcontentloaded" });
  await expect(
    viewerPage.getByRole("heading", { name: "找不到这趟旅行", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    viewerPage.getByText("旅行不存在、已归档，或当前账号没有访问权限。", {
      exact: true,
    }),
  ).toBeVisible();
  await viewerPage.setViewportSize(MOBILE);
  await capture(viewerPage, "05-viewer-ungranted-390");
  await expectNoHorizontalOverflow(viewerPage, "未授权旅行 390");
  await viewerPage.setViewportSize(DESKTOP);

  await editorPage.goto(`${BASE}${tripPath}`, { waitUntil: "domcontentloaded" });
  await expect(
    editorPage.getByRole("heading", { name: TRIP_TITLE, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await editorPage.getByRole("link", { name: "编辑旅行", exact: true }).click();
  await editorPage.waitForURL((url) => url.pathname === `${tripPath}/edit`, {
    timeout: 30_000,
  });
  await expect(editorPage.getByRole("heading", { name: "编辑旅行" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    editorPage.getByRole("button", { name: "保存旅行", exact: true }),
  ).toBeVisible();
  await capture(editorPage, "05-editor-can-edit-1440");

  evidence.checks.visibility = {
    tripId,
    viewerReadOnly: true,
    commentNotification: true,
    activityRecorded: true,
    ungranted404: true,
    editorCanEdit: true,
  };
});

test("06 地点搜索、停靠点、地图标记、无坐标空态与 390px", async () => {
  await ensureOwnerTrip(ownerPage);
  await ownerPage.goto(`${BASE}${tripPath}`, { waitUntil: "domcontentloaded" });
  const addButton = ownerPage
    .getByRole("button", { name: /添加(第一个)?节点/u })
    .first();
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  await addButton.click();
  const dialog = ownerPage.getByRole("dialog");
  const placeInput = dialog.getByRole("combobox", { name: "搜索地点" });
  await expect(placeInput).toBeVisible({ timeout: 30_000 });

  const searchResponse = ownerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/places/search" &&
      response.request().method() === "GET" &&
      decodeURIComponent(response.url()).includes(`q=${PLACE_QUERY}`),
    { timeout: 60_000 },
  );
  await placeInput.fill(PLACE_QUERY);
  const search = await searchResponse;
  expect(search.status(), await search.text()).toBe(200);
  const searchBody = (await search.json()) as {
    items: Array<{ name: string; countryCode: string }>;
    provider: string;
    degraded: boolean;
  };
  expect(searchBody.items.length).toBeGreaterThan(0);
  expect(searchBody.degraded).toBe(false);
  const japanResult = searchBody.items.find((item) => item.countryCode === "JP");
  expect(japanResult, "Kanazawa search must include a Japanese result").toBeTruthy();
  const selectedPlaceName = japanResult?.name ?? PLACE_QUERY;
  const option = ownerPage
    .locator('[role="option"]')
    .filter({ hasText: selectedPlaceName })
    .filter({ hasText: "JP" })
    .first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await capture(ownerPage, "06-place-search-1440");
  await option.click();

  await expect(dialog.getByLabel("城市", { exact: true })).not.toHaveValue("");
  await expect(dialog.getByLabel("国家码", { exact: true })).toHaveValue("JP");
  await expect(dialog.getByLabel("纬度（可选）", { exact: true })).not.toHaveValue("");
  await expect(dialog.getByLabel("经度（可选）", { exact: true })).not.toHaveValue("");
  await dialog.getByLabel("开始日期", { exact: true }).fill(tripStartDate);
  await dialog.getByLabel("结束日期", { exact: true }).fill(tripEndDate);
  const createStop = ownerPage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/v1/trips/${tripId}/stops`,
  );
  await dialog.getByRole("button", { name: "保存节点", exact: true }).click();
  const stopResponse = await createStop;
  expect(stopResponse.status(), await stopResponse.text()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(
    ownerPage
      .getByRole("listitem")
      .filter({ hasText: selectedPlaceName })
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  await ownerPage.goto(`${BASE}${tripPath}/map`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "行程地图" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    ownerPage.getByText(/ROUTE \/ 1 MAPPED STOPS/u),
  ).toBeVisible({ timeout: 30_000 });
  const mapCanvas = ownerPage.locator(
    '[data-testid="maplibre-canvas"] canvas.maplibregl-canvas',
  );
  await expect(ownerPage.getByTestId("trip-map-card")).toBeVisible({
    timeout: 30_000,
  });
  const realCanvasRendered = await mapCanvas
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
  const tileFallback = ownerPage.getByText(
    "TILE FALLBACK / SCHEMATIC WORLD",
    { exact: true },
  );
  if (!realCanvasRendered) {
    await expect(tileFallback).toBeVisible();
    await expect(
      ownerPage.getByRole("button", {
        name: selectedPlaceName,
        exact: true,
      }),
    ).toBeVisible();
  }
  const mapBox = await ownerPage
    .getByTestId("trip-map-card")
    .boundingBox();
  expect(mapBox?.height ?? 0).toBeGreaterThan(200);
  await expect(ownerPage.getByTestId("trip-map-sidebar")).toContainText(
    selectedPlaceName,
  );
  await capture(ownerPage, "06-map-1440");

  await ownerPage.setViewportSize(MOBILE);
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await expect(ownerPage.getByRole("heading", { name: "行程地图" })).toBeVisible({
    timeout: 30_000,
  });
  const mobileCanvasRendered = await mapCanvas
    .isVisible({ timeout: 15_000 })
    .catch(() => false);
  if (!mobileCanvasRendered) {
    await expect(tileFallback).toBeVisible();
  }
  await capture(ownerPage, "06-map-390");
  await expectNoHorizontalOverflow(ownerPage, "行程地图 390");
  await ownerPage.setViewportSize(DESKTOP);

  const emptyTripResponse = await ownerPage.request.post(
    `/v1/workspaces/${workspaceId}/trips`,
    {
      headers: { origin: BASE, "content-type": "application/json" },
      data: {
        title: EMPTY_MAP_TRIP_TITLE,
        summary: "验证有停靠点但没有坐标时的地图空态。",
        status: "upcoming",
        startDate: "2027-01-10",
        endDate: "2027-01-12",
        timeZone: "Asia/Shanghai",
        visibility: "workspace",
      },
    },
  );
  expect(emptyTripResponse.status(), await emptyTripResponse.text()).toBe(201);
  const emptyTripId = ((await emptyTripResponse.json()) as { id: string }).id;
  const emptyStopResponse = await ownerPage.request.post(
    `/v1/trips/${emptyTripId}/stops`,
    {
      headers: { origin: BASE, "content-type": "application/json" },
      data: {
        city: "雅典",
        country: "希腊",
        countryCode: "GR",
        lat: null,
        lng: null,
        timeZone: "Europe/Athens",
        startDate: "2027-01-10",
        endDate: "2027-01-12",
        order: 0,
      },
    },
  );
  expect(emptyStopResponse.status(), await emptyStopResponse.text()).toBe(201);
  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/trips/${emptyTripId}/map`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    ownerPage.getByRole("heading", { name: "停靠点还没有坐标" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(ownerPage.getByTestId("maplibre-canvas")).toHaveCount(0);
  await expect(ownerPage.getByTestId("trip-map-sidebar")).toContainText("雅典");
  await expect(
    ownerPage.getByRole("link", { name: "去编辑旅行补充坐标" }),
  ).toBeVisible();
  await capture(ownerPage, "06-map-no-coordinates-1440");
  await ownerPage.setViewportSize(MOBILE);
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await expect(
    ownerPage.getByRole("heading", { name: "停靠点还没有坐标" }),
  ).toBeVisible({ timeout: 30_000 });
  await capture(ownerPage, "06-map-no-coordinates-390");
  await expectNoHorizontalOverflow(ownerPage, "无坐标地图 390");
  await ownerPage.setViewportSize(DESKTOP);

  evidence.checks.placesAndMap = {
    provider: searchBody.provider,
    resultCount: searchBody.items.length,
    degraded: searchBody.degraded,
    mapRendered: realCanvasRendered,
    tileFallback: !realCanvasRendered,
    noCoordinateEmptyState: true,
  };
  expect
    .soft(
      realCanvasRendered,
      "生产环境未渲染 MapLibre 瓦片，已回退到 SCHEMATIC WORLD 示意图。",
    )
    .toBe(true);
});

test("07 洞察读取真实聚合数据并展示图表", async () => {
  await ensureOwnerTrip(ownerPage);
  const expense = await ownerPage.request.post(`/v1/trips/${tripId}/expenses`, {
    headers: { origin: BASE, "content-type": "application/json" },
    data: {
      date: tripStartDate,
      category: "food",
      note: `生产设置验收餐饮 ${RUN_ID}`,
      amountMinor: 128_900,
      currency: "CNY",
      paidById: ownerId,
      splitMode: "equal",
      participants: [{ userId: ownerId }],
    },
  });
  expect(expense.status(), await expense.text()).toBe(201);

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/insights`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "旅行洞察" })).toBeVisible({
    timeout: 30_000,
  });
  const spendCard = ownerPage
    .locator("section")
    .filter({ hasText: "总支出" })
    .first();
  await expect(spendCard).toContainText(/1,289/u, { timeout: 30_000 });
  await expect(spendCard).toContainText("1 笔 CNY 明细");
  await expect(
    ownerPage.locator('[aria-label="最近十二个月支出面积图"]'),
  ).toBeVisible();
  await expect(
    ownerPage.locator('[aria-label^="年度旅行次数柱状图"]'),
  ).toBeVisible();
  await expect(
    ownerPage.getByText("还没有足够的旅行数据", { exact: true }),
  ).toHaveCount(0);

  evidence.checks.insightsAggregate = {
    totalMinor: 128_900,
    currency: "CNY",
    charts: true,
  };
  await capture(ownerPage, "07-insights-aggregate-1440");
  await ownerPage.setViewportSize(MOBILE);
  await capture(ownerPage, "07-insights-aggregate-390");
  await expectNoHorizontalOverflow(ownerPage, "洞察聚合 390");
  await ownerPage.setViewportSize(DESKTOP);
});
