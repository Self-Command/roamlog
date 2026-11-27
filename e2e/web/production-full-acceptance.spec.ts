/**
 * PRODUCTION_FULL_ACCEPTANCE — real-browser acceptance against the deployed
 * production origin.
 *
 * This spec intentionally uses production APIs and PostgreSQL (via SSH) to
 * provision an isolated workspace, three temporary accounts and seeded data,
 * then exercises the user and admin surfaces in a real browser. It never edits
 * global production settings. All temporary rows are deleted in `afterAll`.
 *
 * Run:
 *   $env:E2E_WEB_URL='https://we.spacedo.org'
 *   $env:E2E_SKIP_WEB_SERVER='1'
 *   $env:E2E_SKIP_ADMIN_SERVER='1'
 *   pnpm exec playwright test e2e/web/production-full-acceptance.spec.ts --project=web --workers=1
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";

const BASE = (process.env.E2E_WEB_URL ?? "https://we.spacedo.org").replace(/\/+$/u, "");
const SSH_HOST = process.env.E2E_PROD_SSH ?? "root@217.217.197.188";
const PG_CONTAINER = process.env.E2E_PROD_PG_CONTAINER ?? "roamlog-postgres-1";
const RUN_ID = `prod-${Date.now().toString(36)}`;
const PASSWORD = "Roamlog-Prod-Aa1!";
const SHARE_PASSWORD = "Roamlog-Share-Aa1!";
const OWNER_EMAIL = `${RUN_ID}-owner@roamlog.test`;
const VIEWER_EMAIL = `${RUN_ID}-viewer@roamlog.test`;
const ADMIN_EMAIL = `${RUN_ID}-admin@roamlog.test`;
const WORKSPACE_NAME = `生产验收 ${RUN_ID}`;
const WORKSPACE_SLUG = RUN_ID;
const TRIP_TITLE = `生产验收旅行 ${RUN_ID}`;
const ENTRY_TITLE = `生产验收日志 ${RUN_ID}`;
const STOP_CITY = "京都";
const OUT_DIR = path.resolve(process.cwd(), ".audit", "production", RUN_ID);
const KYOTO_IMAGE = readFileSync(
  path.resolve(process.cwd(), "packages/db/seed-assets/kyoto-alley.jpg"),
);

test.describe.configure({ mode: "serial", retries: 0 });
test.use({ viewport: { width: 1440, height: 1000 } });

let ownerApi: APIRequestContext;
let adminApi: APIRequestContext;
let viewerApi: APIRequestContext;
let anonApi: APIRequestContext;
let ownerContext: Awaited<ReturnType<Browser["newContext"]>>;
let viewerContext: Awaited<ReturnType<Browser["newContext"]>>;
let adminContext: Awaited<ReturnType<Browser["newContext"]>>;
let ownerPage: Page;
let viewerPage: Page;
let adminPage: Page;
let ownerId = "";
let viewerId = "";
let adminId = "";
let adminTotpSecret = "";
let workspaceId = "";
let tripId = "";
let entryId = "";
let mediaId = "";
let shareToken = "";
let shareLinkId = "";

function sql(statement: string): string {
  const encoded = Buffer.from(statement, "utf8").toString("base64");
  return execSync(
    `ssh ${SSH_HOST} "printf '%s' '${encoded}' | base64 -d | docker exec -i ${PG_CONTAINER} psql -U roamlog -d roamlog -v ON_ERROR_STOP=1 -f -"`,
    { encoding: "utf8" },
  );
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replace(/=+$/u, "").toUpperCase();
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function serverEpochSeconds(): number {
  return Number(
    execSync(`ssh ${SSH_HOST} "date +%s"`, { encoding: "utf8" }).trim(),
  );
}

function totp(secret: string, atSeconds: number = serverEpochSeconds()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atSeconds / 30)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest.at(-1)! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

async function signUp(api: APIRequestContext, email: string, name: string): Promise<string> {
  const response = await api.post("/v1/auth/sign-up/email", {
    data: { email, password: PASSWORD, name },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return body.user.id;
}

async function signIn(api: APIRequestContext, email: string): Promise<void> {
  const response = await api.post("/v1/auth/sign-in/email", {
    data: { email, password: PASSWORD, rememberMe: true },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function seed(): Promise<void> {
  ownerApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  adminApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  viewerApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
  anonApi = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });

  ownerId = await signUp(ownerApi, OWNER_EMAIL, "生产验收 Owner");
  viewerId = await signUp(ownerApi, VIEWER_EMAIL, "生产验收 Viewer");
  adminId = await signUp(ownerApi, ADMIN_EMAIL, "生产验收 Admin");

  sql(`
UPDATE "User" SET "emailVerified" = true
WHERE email IN ('${OWNER_EMAIL}','${VIEWER_EMAIL}','${ADMIN_EMAIL}');
UPDATE "User" SET "platformRole" = 'super_admin' WHERE email = '${ADMIN_EMAIL}';
`);

  await signIn(ownerApi, OWNER_EMAIL);
  const workspace = await ownerApi.post("/v1/workspaces", {
    data: {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
    },
  });
  expect(workspace.status(), await workspace.text()).toBe(201);
  workspaceId = ((await workspace.json()) as { id: string }).id;

  sql(`
INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role, status, "joinedAt", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '${workspaceId}', '${viewerId}', 'viewer', 'active', now(), now(), now());
`);
  await signIn(viewerApi, VIEWER_EMAIL);

  await signIn(adminApi, ADMIN_EMAIL);
  const enable = await adminApi.post("/v1/auth/two-factor/enable", {
    data: { password: PASSWORD, method: "totp" },
  });
  expect(enable.status(), await enable.text()).toBe(200);
  const totpUri = ((await enable.json()) as { totpURI: string }).totpURI;
  adminTotpSecret = new URL(totpUri).searchParams.get("secret") ?? "";
  expect(adminTotpSecret.length).toBeGreaterThan(0);
  const verify = await adminApi.post("/v1/auth/two-factor/verify-totp", {
    data: { code: totp(adminTotpSecret) },
  });
  expect(verify.status(), await verify.text()).toBe(200);

  const trip = await ownerApi.post(`/v1/workspaces/${workspaceId}/trips`, {
    data: {
      title: TRIP_TITLE,
      summary: "生产环境全流程验收：行程、日志、费用、行李、分享与 AI。",
      status: "upcoming",
      startDate: "2026-12-10",
      endDate: "2026-12-14",
      origin: "上海",
      originCountryCode: "CN",
      timeZone: "Asia/Shanghai",
      destinationsV2: [
        {
          name: "京都",
          country: "日本",
          countryCode: "JP",
          lat: 35.0116,
          lng: 135.7681,
          timeZone: "Asia/Tokyo",
        },
      ],
      tags: ["验收", "AI"],
      budgetAmountMinor: 500000,
      budgetCurrency: "CNY",
      visibility: "workspace",
    },
  });
  expect(trip.status(), await trip.text()).toBe(201);
  tripId = ((await trip.json()) as { id: string }).id;
  const participant = await ownerApi.post(`/v1/trips/${tripId}/participants`, {
    data: { userId: viewerId },
  });
  expect(participant.status(), await participant.text()).toBe(201);

  const stop = await ownerApi.post(`/v1/trips/${tripId}/stops`, {
    data: {
      city: STOP_CITY,
      country: "日本",
      countryCode: "JP",
      lat: 35.0116,
      lng: 135.7681,
      timeZone: "Asia/Tokyo",
      startDate: "2026-12-10",
      endDate: "2026-12-14",
      notes: "生产验收停靠点",
      order: 0,
    },
  });
  expect(stop.status(), await stop.text()).toBe(201);

  const entry = await ownerApi.post(`/v1/trips/${tripId}/entries`, {
    data: {
      title: ENTRY_TITLE,
      date: "2026-12-11",
      location: STOP_CITY,
      lat: 35.0116,
      lng: 135.7681,
      mood: "happy",
      weather: "sunny",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "这是生产环境验收写入的日志正文。" }],
          },
        ],
      },
      contentHtml: "<p>这是生产环境验收写入的日志正文。</p>",
      excerpt: "生产验收日志摘要",
      tags: ["验收"],
    },
  });
  expect(entry.status(), await entry.text()).toBe(201);
  entryId = ((await entry.json()) as { id: string }).id;

  const expense = await ownerApi.post(`/v1/trips/${tripId}/expenses`, {
    data: {
      date: "2026-12-11",
      category: "food",
      note: "生产验收晚餐",
      amountMinor: 12800,
      currency: "CNY",
      paidById: ownerId,
      splitMode: "equal",
      participants: [{ userId: ownerId }, { userId: viewerId }],
    },
  });
  expect(expense.status(), await expense.text()).toBe(201);

  const packing = await ownerApi.post(`/v1/trips/${tripId}/packing`, {
    data: { category: "documents", name: "护照", quantity: 1 },
  });
  expect(packing.status(), await packing.text()).toBe(201);

  const presign = await ownerApi.post(`/v1/workspaces/${workspaceId}/media/presign`, {
    data: {
      tripId,
      fileName: "production-kyoto-alley.jpg",
      mimeType: "image/jpeg",
      size: KYOTO_IMAGE.length,
      width: 1200,
      height: 800,
      caption: "生产验收图片",
    },
  });
  expect(presign.status(), await presign.text()).toBe(201);
  const presigned = (await presign.json()) as {
    mediaId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  mediaId = presigned.mediaId;
  const upload = await ownerApi.put(presigned.uploadUrl, {
    headers: presigned.headers,
    data: KYOTO_IMAGE,
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const complete = await ownerApi.post(`/v1/media/${mediaId}/complete`, {
    data: { width: 1200, height: 800 },
  });
  expect(complete.status(), await complete.text()).toBe(200);
  let mediaReady = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = await ownerApi.get(`/v1/media/${mediaId}`);
    if (current.status() === 200) {
      const body = (await current.json()) as { status?: string };
      if (body.status === "ready") {
        mediaReady = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  expect(mediaReady, "worker must process the uploaded media").toBe(true);
  const cover = await ownerApi.post(`/v1/trips/${tripId}/cover`, {
    data: { mediaId },
  });
  expect(cover.status(), await cover.text()).toBe(200);

  const share = await ownerApi.post(`/v1/trips/${tripId}/share-links`, {
    data: { password: SHARE_PASSWORD, showBudget: true, allowIndex: false },
  });
  expect(share.status(), await share.text()).toBe(201);
  const created = (await share.json()) as { id: string; token: string };
  shareLinkId = created.id;
  shareToken = created.token;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function waitForAiIdle(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0, {
    timeout: 180_000,
  });
}

async function gotoAi(page: Page): Promise<void> {
  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "AI 旅行助手" })).toBeVisible({
    timeout: 30_000,
  });
  // The selector is server-rendered with a loading label. Waiting for the
  // real model proves React hydration and the authenticated model request
  // have completed before the test starts clicking controls.
  await expect(page.getByTestId("model-selector-current")).not.toContainText("正在加载", {
    timeout: 30_000,
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await seed();

  ownerContext = await browser.newContext({
    storageState: await ownerApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  viewerContext = await browser.newContext({
    storageState: await viewerApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  adminContext = await browser.newContext({
    storageState: await adminApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  ownerPage = await ownerContext.newPage();
  viewerPage = await viewerContext.newPage();
  adminPage = await adminContext.newPage();
});

test.afterAll(async () => {
  try {
    if (workspaceId) {
      sql(`
DELETE FROM "Workspace" WHERE id = '${workspaceId}';
DELETE FROM "Workspace" WHERE "ownerId" IN (
  SELECT id FROM "User" WHERE email IN ('${OWNER_EMAIL}','${VIEWER_EMAIL}','${ADMIN_EMAIL}')
);
DELETE FROM "User" WHERE email IN ('${OWNER_EMAIL}','${VIEWER_EMAIL}','${ADMIN_EMAIL}');
`);
    }
  } finally {
    await ownerContext?.close();
    await viewerContext?.close();
    await adminContext?.close();
    await ownerApi?.dispose();
    await adminApi?.dispose();
    await viewerApi?.dispose();
    await anonApi?.dispose();
  }
});

test("01 public login page and owner session", async ({ browser }) => {
  const anonContext = await browser.newContext();
  const page = await anonContext.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "登录 Roamlog" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await shot(page, "01-login-1440");
  await anonContext.close();

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}`, { waitUntil: "domcontentloaded" });
  await expect(ownerPage.getByRole("heading", { name: "旅行总览" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(ownerPage.getByText(TRIP_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await shot(ownerPage, "01-dashboard-1440");
});

test("02 trips library and full trip workspace", async () => {
  const page = ownerPage;
  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/trips`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(TRIP_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "02-trips-1440");

  await page.getByText(TRIP_TITLE).first().click();
  await expect(page.getByRole("heading", { name: TRIP_TITLE })).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, "02-trip-overview-1440");

  for (const tab of ["行程", "照片", "费用", "行李", "参与者", "分享", "活动"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await page.getByRole("tab", { name: "行程", exact: true }).click();
  await expect(page.getByText(STOP_CITY).first()).toBeVisible();
  await page.getByRole("tab", { name: "费用", exact: true }).click();
  await expect(page.getByText("生产验收晚餐").first()).toBeVisible();
  await page.getByRole("tab", { name: "行李", exact: true }).click();
  await expect(page.getByText("护照").first()).toBeVisible();
  await page.getByRole("tab", { name: "参与者", exact: true }).click();
  await expect(page.getByText(VIEWER_EMAIL).first()).toBeVisible();
});

test("03 journal, map, insights, members, activity, notifications", async () => {
  const page = ownerPage;
  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/journal`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(ENTRY_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "03-journal-1440");

  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/map`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(STOP_CITY).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "03-map-1440");

  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/insights`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toBeVisible();
  await shot(page, "03-insights-1440");

  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/members`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(VIEWER_EMAIL).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "03-members-1440");

  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/activity`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toBeVisible();

  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/notifications`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("main")).toBeVisible();
});

test("04 appearance switching from settings", async () => {
  const page = ownerPage;
  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/settings/appearance`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "外观" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "04-appearance-1440");

  await page.getByRole("radio", { name: /Geist/u }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "geist");
  await page.getByRole("radio", { name: /深色/u }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.getByRole("radio", { name: /Mercury 墨紫/u }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "mercury");
  await page.getByRole("radio", { name: /跟随系统/u }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
});

test("05 public share link password flow", async () => {
  const publicContext = await ownerContext.browser()!.newContext();
  const page = await publicContext.newPage();
  await page.goto(`${BASE}/share/${shareToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "输入分享密码" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");
  await shot(page, "05-share-password-1440");
  await page.getByLabel("分享密码").fill(SHARE_PASSWORD);
  const openShare = page.getByRole("button", { name: "打开分享" });
  await expect(openShare).toBeEnabled({ timeout: 30_000 });
  await openShare.click();
  await expect(page.getByText(TRIP_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await publicContext.close();
});

test("06 viewer only sees read-only trip", async () => {
  const page = viewerPage;
  await page.goto(`${BASE}/w/${WORKSPACE_SLUG}/trips/${tripId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: TRIP_TITLE })).toBeVisible({
    timeout: 30_000,
  });
  const edit = page.getByRole("link", { name: /编辑/u }).first();
  if ((await edit.count()) > 0) {
    await expect(edit).toHaveAttribute("aria-disabled", "true");
  }
  await shot(page, "06-viewer-trip-1440");
});

test("07 AI streaming, reasoning layout and persistence", async () => {
  test.setTimeout(240_000);
  const page = ownerPage;
  await gotoAi(page);
  await shot(page, "07-ai-empty-1440");

  const composer = page.getByLabel("给 AI 助手发消息");
  await composer.fill("请展示你的思考过程，然后用一句话回答：旅行中最重要的是什么？");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible({
    timeout: 60_000,
  });
  const reasoningToggle = page.getByTestId("message-reasoning").getByRole("button").first();
  await expect(reasoningToggle).toBeVisible({ timeout: 60_000 });
  if ((await reasoningToggle.getAttribute("aria-expanded")) !== "true") {
    await reasoningToggle.click();
  }
  const reasoning = page.getByTestId("reasoning-body").first();
  await expect(reasoning).toBeVisible({ timeout: 60_000 });
  const style = await reasoning.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { overflowY: computed.overflowY, maxHeight: computed.maxHeight };
  });
  expect(style.overflowY).toBe("visible");
  expect(style.maxHeight).toBe("none");
  await shot(page, "07-ai-reasoning-1440");
  await waitForAiIdle(page);
  await expect(page.getByTestId("message-assistant").first()).toBeVisible();

  const url = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("message-assistant").first()).toBeVisible({
    timeout: 30_000,
  });
  expect(page.url()).toBe(url);
});

test("08 AI selectors, attachment and background conversation switch", async () => {
  test.setTimeout(300_000);
  const page = ownerPage;
  await gotoAi(page);

  await page.getByTestId("model-selector").click();
  await expect(page.getByTestId("model-selector-search")).toBeVisible();
  await expect(page.locator('[data-testid^="model-option-"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.press("Escape");

  await page.getByTestId("reasoning-selector").click();
  await expect(page.locator('[data-testid^="reasoning-option-"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.press("Escape");

  await page.getByTestId("attachments-input").setInputFiles({
    name: "production-kyoto-alley.jpg",
    mimeType: "image/jpeg",
    buffer: KYOTO_IMAGE,
  });
  await expect(page.getByTestId("attachments-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("input-attachment-preview")).toHaveAttribute(
    "data-attachment-status",
    "complete",
    { timeout: 30_000 },
  );
  const composer = page.getByLabel("给 AI 助手发消息");
  await composer.fill("请只读出图片中最大的英文文字，并原样回答。");
  await composer.press("Enter");
  await waitForAiIdle(page);
  const imageAnswer = page.getByTestId("message-assistant").last();
  await expect(imageAnswer).toBeVisible();
  await expect(imageAnswer).toContainText(/KYOTO\s*\/\s*ALLEY/iu, { timeout: 60_000 });

  await composer.fill("请用大约三百字介绍京都冬季旅行，先思考再回答。");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible({
    timeout: 60_000,
  });
  const conversationUrl = page.url();
  const cancelRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/stream/cancel")) {
      cancelRequests.push(request.url());
    }
  });
  await page.getByRole("button", { name: "新建会话" }).click();
  await page.waitForTimeout(2_000);
  expect(cancelRequests).toHaveLength(0);

  await page.goto(conversationUrl, { waitUntil: "domcontentloaded" });
  await waitForAiIdle(page);
  await expect(page.getByTestId("message-assistant").first()).toBeVisible({
    timeout: 30_000,
  });
  expect(cancelRequests).toHaveLength(0);
  await shot(page, "08-ai-background-1440");
});

test("09 admin dashboard, users, workspaces, moderation, media, audit", async ({ browser }) => {
  const anonContext = await browser.newContext();
  const loginPage = await anonContext.newPage();
  await loginPage.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await expect(
    loginPage.getByRole("heading", { name: "进入平台控制台" }),
  ).toBeVisible();
  await expect(loginPage.getByLabel("管理员邮箱")).toBeVisible();
  await anonContext.close();

  const page = adminPage;
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, "09-admin-dashboard-1440");

  await page.getByRole("link", { name: "用户", exact: true }).click();
  await expect(page.getByRole("heading", { name: "用户", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(OWNER_EMAIL).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "09-admin-users-1440");

  await page.getByRole("link", { name: "工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作区", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(WORKSPACE_NAME).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "内容审核", exact: true }).click();
  await expect(page.getByRole("heading", { name: "内容审核", level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("link", { name: "媒体库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "媒体库", level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("link", { name: "审计日志", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审计日志", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
});

test("10 admin settings and every service surface", async () => {
  const page = adminPage;
  await page.goto(`${BASE}/admin/settings?tab=theme`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "外观与字体" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/9 套企业主题/u)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Mercury 墨紫/u })).toBeVisible();
  await shot(page, "10-admin-appearance-1440");
  for (const tab of ["通用", "SEO", "限制"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }

  const services: Array<[string, string]> = [
    ["AI 服务", "AI 服务"],
    ["存储服务", "存储服务"],
    ["地图服务", "地图服务"],
    ["发信服务", "发信服务"],
    ["媒体处理", "媒体处理"],
    ["邮件", "邮件"],
    ["队列", "队列"],
    ["功能开关", "功能开关"],
    ["系统健康", "系统健康"],
  ];
  for (const [link, heading] of services) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
      timeout: 30_000,
    });
  }

  await page.getByRole("button", { name: "主题与深浅色" }).click();
  await expect(page.getByText(/深色|浅色|跟随系统/u).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("11 mobile smoke for dashboard, trip, AI and admin", async () => {
  const page = await ownerContext.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, name] of [
    [`/w/${WORKSPACE_SLUG}`, "11-mobile-dashboard"],
    [`/w/${WORKSPACE_SLUG}/trips/${tripId}`, "11-mobile-trip"],
    [`/w/${WORKSPACE_SLUG}/ai`, "11-mobile-ai"],
  ] as const) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await noHorizontalOverflow(page);
    await shot(page, name);
  }
  await page.close();

  const adminMobile = await adminContext.newPage();
  await adminMobile.setViewportSize({ width: 390, height: 844 });
  await adminMobile.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await expect(adminMobile.getByRole("heading", { name: "平台总览" })).toBeVisible({
    timeout: 30_000,
  });
  await noHorizontalOverflow(adminMobile);
  await shot(adminMobile, "11-mobile-admin");
  await adminMobile.close();
});
