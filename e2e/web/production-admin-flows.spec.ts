/**
 * PRODUCTION_ADMIN_FLOWS — real-browser write and permission acceptance against
 * the deployed Admin console.
 *
 * This spec provisions isolated production accounts and one Workspace, seeds a
 * trip, journal entry, two moderation reports and a real uploaded image, then
 * exercises the Admin UI with reversible actions. It never edits global
 * provider or platform settings. All temporary rows are removed in `afterAll`.
 *
 * Run:
 *   $env:E2E_WEB_URL='https://we.spacedo.org'
 *   $env:E2E_SKIP_WEB_SERVER='1'
 *   $env:E2E_SKIP_ADMIN_SERVER='1'
 *   $out = ".audit/production-admin-playwright/$(Get-Date -Format yyyyMMddHHmmss)"
 *   pnpm exec playwright test e2e/web/production-admin-flows.spec.ts --project=web --workers=1 --output=$out
 */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_WEB_URL ?? "https://we.spacedo.org").replace(/\/+$/u, "");
const SSH_HOST = process.env.E2E_PROD_SSH ?? "root@217.217.197.188";
const PG_CONTAINER = process.env.E2E_PROD_PG_CONTAINER ?? "roamlog-postgres-1";
const RUN_ID = `prod-admin-${Date.now().toString(36)}`;
const PASSWORD = "Roamlog-Admin-Aa1!";
const OWNER_EMAIL = `${RUN_ID}-owner@roamlog.test`;
const VIEWER_EMAIL = `${RUN_ID}-viewer@roamlog.test`;
const ANALYST_EMAIL = `${RUN_ID}-analyst@roamlog.test`;
const SUPPORT_EMAIL = `${RUN_ID}-support@roamlog.test`;
const OWNER_NAME = `后台验收 Owner ${RUN_ID}`;
const VIEWER_NAME = `后台验收 Viewer ${RUN_ID}`;
const WORKSPACE_NAME = `后台验收工作区 ${RUN_ID}`;
const WORKSPACE_SLUG = RUN_ID;
const TRIP_TITLE = `后台验收旅行 ${RUN_ID}`;
const ENTRY_TITLE = `后台验收日志 ${RUN_ID}`;
const MEDIA_FILE_NAME = `admin-kyoto-${RUN_ID}.jpg`;
const OUT_DIR = path.resolve(process.cwd(), ".audit", "production-admin", RUN_ID);
const KYOTO_IMAGE = readFileSync(
  path.resolve(process.cwd(), "packages/db/seed-assets/kyoto-alley.jpg"),
);

test.describe.configure({ mode: "serial", retries: 0 });
test.use({ viewport: { width: 1440, height: 1000 } });

let ownerApi: APIRequestContext;
let viewerApi: APIRequestContext;
let analystApi: APIRequestContext;
let supportApi: APIRequestContext;

let ownerContext: BrowserContext;
let adminContext: BrowserContext;
let analystContext: BrowserContext;
let supportContext: BrowserContext;
let ownerPage: Page;
let adminPage: Page;
let analystPage: Page;
let supportPage: Page;

let operatorTotpSecret = "";
let workspaceId = "";
let tripId = "";
let entryId = "";
let mediaId = "";

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
  return Number(execSync(`ssh ${SSH_HOST} "date +%s"`, { encoding: "utf8" }).trim());
}

function totp(secret: string, atSeconds: number = serverEpochSeconds()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atSeconds / 30)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest.at(-1)! & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function apiContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { Origin: BASE },
  });
}

async function postWithRateLimitRetry(
  api: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
): Promise<Awaited<ReturnType<APIRequestContext["post"]>>> {
  let last: Awaited<ReturnType<APIRequestContext["post"]>> | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await api.post(url, { data });
    if (last.status() !== 429) return last;
    const retryAfter = Number(last.headers()["retry-after"] ?? "30");
    const delayMs = Math.min(Math.max(retryAfter, 1), 90) * 1_000 + 500;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last!;
}

async function signUp(api: APIRequestContext, email: string, name: string): Promise<string> {
  const response = await postWithRateLimitRetry(api, "/v1/auth/sign-up/email", {
    email,
    password: PASSWORD,
    name,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return body.user.id;
}

async function signIn(api: APIRequestContext, email: string): Promise<void> {
  const response = await postWithRateLimitRetry(api, "/v1/auth/sign-in/email", {
    email,
    password: PASSWORD,
    rememberMe: true,
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function enableTotp(api: APIRequestContext): Promise<string> {
  const enable = await postWithRateLimitRetry(api, "/v1/auth/two-factor/enable", {
    password: PASSWORD,
    method: "totp",
  });
  expect(enable.status(), await enable.text()).toBe(200);
  const body = (await enable.json()) as { totpURI: string };
  const secret = new URL(body.totpURI).searchParams.get("secret") ?? "";
  expect(secret.length).toBeGreaterThan(0);
  const verify = await postWithRateLimitRetry(api, "/v1/auth/two-factor/verify-totp", {
    code: totp(secret),
  });
  expect(verify.status(), await verify.text()).toBe(200);
  return secret;
}

async function seed(): Promise<void> {
  ownerApi = await apiContext();
  viewerApi = await apiContext();
  analystApi = await apiContext();
  supportApi = await apiContext();

  await signUp(ownerApi, OWNER_EMAIL, OWNER_NAME);
  const viewerId = await signUp(viewerApi, VIEWER_EMAIL, VIEWER_NAME);
  const analystId = await signUp(analystApi, ANALYST_EMAIL, `后台验收 Analyst ${RUN_ID}`);
  const supportId = await signUp(supportApi, SUPPORT_EMAIL, `后台验收 Support ${RUN_ID}`);

  sql(`
UPDATE "User" SET "emailVerified" = true
WHERE email IN (
  '${OWNER_EMAIL}',
  '${VIEWER_EMAIL}',
  '${ANALYST_EMAIL}',
  '${SUPPORT_EMAIL}'
);
UPDATE "User" SET "platformRole" = 'super_admin' WHERE email = '${OWNER_EMAIL}';
UPDATE "User" SET "platformRole" = 'analyst' WHERE email = '${ANALYST_EMAIL}';
UPDATE "User" SET "platformRole" = 'support' WHERE email = '${SUPPORT_EMAIL}';
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

  const trip = await ownerApi.post(`/v1/workspaces/${workspaceId}/trips`, {
    data: {
      title: TRIP_TITLE,
      summary: "生产后台写操作与权限验收数据。",
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
      tags: ["后台验收"],
      budgetAmountMinor: 300000,
      budgetCurrency: "CNY",
      visibility: "workspace",
    },
  });
  expect(trip.status(), await trip.text()).toBe(201);
  tripId = ((await trip.json()) as { id: string }).id;

  const entry = await ownerApi.post(`/v1/trips/${tripId}/entries`, {
    data: {
      title: ENTRY_TITLE,
      date: "2026-12-11",
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
            content: [{ type: "text", text: "生产后台内容审核验收正文。" }],
          },
        ],
      },
      contentHtml: "<p>生产后台内容审核验收正文。</p>",
      excerpt: "生产后台内容审核验收",
      tags: ["后台验收"],
    },
  });
  expect(entry.status(), await entry.text()).toBe(201);
  entryId = ((await entry.json()) as { id: string }).id;

  await signIn(viewerApi, VIEWER_EMAIL);
  for (const [api, detail] of [
    [ownerApi, "Owner 举报：需要平台复核。"],
    [viewerApi, "Viewer 举报：需要平台复核。"],
  ] as const) {
    const report = await api.post(`/v1/workspaces/${workspaceId}/reports`, {
      data: {
        targetType: "entry",
        targetId: entryId,
        reason: "other",
        detail,
      },
    });
    expect(report.status(), await report.text()).toBe(201);
  }

  const presign = await ownerApi.post(`/v1/workspaces/${workspaceId}/media/presign`, {
    data: {
      tripId,
      fileName: MEDIA_FILE_NAME,
      mimeType: "image/jpeg",
      size: KYOTO_IMAGE.length,
      width: 1200,
      height: 800,
      caption: "后台媒体库验收图片",
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
  expect(mediaReady, "worker must process the uploaded Admin test image").toBe(true);

  await signIn(analystApi, ANALYST_EMAIL);
  await signIn(supportApi, SUPPORT_EMAIL);
  operatorTotpSecret = await enableTotp(ownerApi);

  // Production rate-limits 2FA enrollment by IP. The permission-role accounts
  // still need authentic TOTP rows, so clone the verified enrollment generated
  // once for the primary test operator instead of hammering the enroll endpoint.
  sql(`
INSERT INTO "TwoFactor" (
  id,
  secret,
  "backupCodes",
  "userId",
  verified,
  "failedVerificationCount",
  "lockedUntil"
)
SELECT gen_random_uuid(), secret, "backupCodes", '${analystId}', true, 0, NULL
FROM "TwoFactor"
WHERE "userId" = (
  SELECT id FROM "User" WHERE email = '${OWNER_EMAIL}'
);
INSERT INTO "TwoFactor" (
  id,
  secret,
  "backupCodes",
  "userId",
  verified,
  "failedVerificationCount",
  "lockedUntil"
)
SELECT gen_random_uuid(), secret, "backupCodes", '${supportId}', true, 0, NULL
FROM "TwoFactor"
WHERE "userId" = (
  SELECT id FROM "User" WHERE email = '${OWNER_EMAIL}'
);
UPDATE "User" SET "twoFactorEnabled" = true WHERE id IN ('${analystId}', '${supportId}');
`);
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

async function gotoAdmin(page: Page, route: string, heading: string): Promise<void> {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: heading, level: 1 }).first()).toBeVisible({
    timeout: 30_000,
  });
}

function routePattern(route: string): RegExp {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`${escaped}(?:\\?.*)?$`, "u");
}

async function submitAdminCredentials(page: Page): Promise<void> {
  const challenge = page.getByRole("heading", { name: "两步验证" });
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/u }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: "登录", exact: true }).click();
    try {
      await challenge.waitFor({ state: "visible", timeout: 15_000 });
      return;
    } catch {
      // A rate-limit or credential error is rendered as an alert below.
    }

    await alert.waitFor({ state: "visible", timeout: 15_000 });
    const message = await alert.innerText();
    if (!/too many requests|rate limit|retry after|429/iu.test(message)) {
      throw new Error(`Admin credential sign-in failed: ${message}`);
    }
    await page.waitForTimeout(65_000);
  }
  throw new Error("Admin credential sign-in remained rate limited after three attempts.");
}

async function submitAdminTotp(page: Page, secret: string): Promise<void> {
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/u }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel("6 位验证码").fill(totp(secret));
    await page.getByRole("button", { name: "验证并进入控制台" }).click();
    try {
      await page.waitForURL(routePattern("/admin"), { timeout: 15_000 });
      return;
    } catch {
      // A rate-limit or invalid-code error is rendered as an alert below.
    }

    await alert.waitFor({ state: "visible", timeout: 15_000 });
    const message = await alert.innerText();
    if (!/too many requests|rate limit|retry after|429/iu.test(message)) {
      throw new Error(`Admin TOTP verification failed: ${message}`);
    }
    await page.waitForTimeout(65_000);
  }
  throw new Error("Admin TOTP verification remained rate limited after three attempts.");
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT_DIR, { recursive: true });
  await seed();

  adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  adminPage = await adminContext.newPage();

  ownerContext = await browser.newContext({
    storageState: await ownerApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  ownerPage = await ownerContext.newPage();

  analystContext = await browser.newContext({
    storageState: await analystApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  analystPage = await analystContext.newPage();

  supportContext = await browser.newContext({
    storageState: await supportApi.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  supportPage = await supportContext.newPage();
});

test.afterAll(async () => {
  await Promise.allSettled([
    ownerContext?.close(),
    adminContext?.close(),
    analystContext?.close(),
    supportContext?.close(),
    ownerApi?.dispose(),
    viewerApi?.dispose(),
    analystApi?.dispose(),
    supportApi?.dispose(),
  ]);

  try {
    if (workspaceId) {
      sql(`DELETE FROM "Workspace" WHERE id = '${workspaceId}';`);
    }
    sql(`
DELETE FROM "User"
WHERE email IN (
  '${OWNER_EMAIL}',
  '${VIEWER_EMAIL}',
  '${ANALYST_EMAIL}',
  '${SUPPORT_EMAIL}'
);
`);
  } catch (error) {
    console.error("Admin production acceptance cleanup failed", error);
  }
});

test("01 real Admin credentials and TOTP login", async () => {
  test.setTimeout(300_000);
  await adminPage.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
  await expect(adminPage.getByRole("heading", { name: "进入平台控制台" })).toBeVisible();

  await adminPage.getByLabel("管理员邮箱").fill(OWNER_EMAIL);
  await adminPage.getByLabel("密码").fill(PASSWORD);
  await submitAdminCredentials(adminPage);
  await expect(adminPage.getByRole("heading", { name: "两步验证" })).toBeVisible();
  expect(adminPage.url()).not.toContain("password=");
  await submitAdminTotp(adminPage, operatorTotpSecret);
  await expect(adminPage).toHaveURL(`${BASE}/admin`, { timeout: 30_000 });
  await expect(adminPage.getByRole("heading", { name: "平台总览" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(adminPage.getByText("生产环境", { exact: true }).first()).toBeVisible();
  await expect(adminPage.getByText("预发布环境", { exact: true })).toHaveCount(0);
  await shot(adminPage, "01-admin-dashboard-1440");
});

test("02 every Admin route renders real data, providers and priority surfaces", async () => {
  test.setTimeout(300_000);
  const routes = [
    ["总览", "/admin", "平台总览"],
    ["用户", "/admin/users", "用户"],
    ["工作区", "/admin/workspaces", "工作区"],
    ["内容审核", "/admin/content", "内容审核"],
    ["权限矩阵", "/admin/permissions", "权限矩阵"],
    ["审计日志", "/admin/audit", "审计日志"],
    ["媒体库", "/admin/media", "媒体库"],
    ["AI 服务", "/admin/services/ai", "AI 服务"],
    ["存储服务", "/admin/services/storage", "存储服务"],
    ["地图服务", "/admin/services/places", "地图服务"],
    ["发信服务", "/admin/services/mail", "发信服务"],
    ["媒体处理", "/admin/services/media", "媒体处理"],
    ["邮件", "/admin/emails", "邮件"],
    ["队列", "/admin/queues", "任务队列"],
    ["功能开关", "/admin/flags", "功能开关"],
    ["系统设置", "/admin/settings", "系统设置"],
    ["系统健康", "/admin/system", "系统健康"],
  ] as const;

  for (const [linkName, route, heading] of routes) {
    await adminPage.getByRole("link", { name: linkName, exact: true }).click();
    await expect(adminPage).toHaveURL(routePattern(route), { timeout: 30_000 });
    await expect(adminPage.getByRole("heading", { name: heading, level: 1 }).first()).toBeVisible({
      timeout: 30_000,
    });
    await adminPage.waitForLoadState("networkidle");
    const routeSlug = route.replace(/^\/admin\/?/u, "").replaceAll("/", "-") || "dashboard";
    await shot(adminPage, `02-route-${routeSlug}-1440`);
  }

  await gotoAdmin(adminPage, "/admin/services/ai", "AI 服务");
  const aiRows = adminPage.getByTestId("provider-table").locator("tbody tr");
  await expect(adminPage.getByTestId("provider-table")).toBeVisible({ timeout: 30_000 });
  expect(await aiRows.count()).toBeGreaterThan(0);
  await adminPage.getByRole("button", { name: "添加服务商" }).click();
  await expect(adminPage.getByRole("heading", { name: "添加服务商" })).toBeVisible({
    timeout: 30_000,
  });
  await adminPage.keyboard.press("Escape");
  await shot(adminPage, "02-ai-providers-1440");

  await gotoAdmin(adminPage, "/admin/services/places", "地图服务");
  const placeRows = adminPage.getByTestId("provider-table").locator("tbody tr");
  await expect(adminPage.getByTestId("provider-table")).toBeVisible({ timeout: 30_000 });
  expect(await placeRows.count()).toBeGreaterThanOrEqual(2);
  await expect(adminPage.getByText(/2 个服务商/u).first()).toBeVisible();
  await expect(adminPage.getByTestId("provider-policy-card")).toBeVisible();
  await expect(adminPage.getByLabel("路由模式")).toBeVisible();
  await shot(adminPage, "02-map-providers-1440");

  await gotoAdmin(adminPage, "/admin/settings", "系统设置");
  for (const tab of ["通用", "SEO", "外观与字体", "限制"] as const) {
    const tabControl = adminPage.getByRole("tab", { name: tab, exact: true });
    await tabControl.click();
    await expect(tabControl).toHaveAttribute("aria-selected", "true");
    await expect(adminPage.getByRole("tabpanel", { name: tab })).toBeVisible();
  }
  await shot(adminPage, "02-settings-tabs-1440");
});

test("03 suspend and restore a real user, then verify audit history", async () => {
  test.setTimeout(180_000);
  await gotoAdmin(adminPage, "/admin/users", "用户");
  const search = adminPage.getByLabel("搜索用户");
  await search.fill(VIEWER_EMAIL);

  const row = adminPage.getByRole("row").filter({ hasText: VIEWER_EMAIL }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const usersDownload = adminPage.waitForEvent("download");
  await adminPage.getByRole("button", { name: "导出 CSV" }).click();
  expect((await usersDownload).suggestedFilename()).toMatch(
    /^roamlog-admin-users(?:-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})?\.csv$/u,
  );

  await row.getByRole("button", { name: "暂停账户" }).click();

  let dialog = adminPage.getByRole("dialog", { name: "暂停账户" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("输入用户姓名确认").fill(VIEWER_NAME);
  await dialog.getByRole("button", { name: "确认暂停" }).click();

  await expect(row.getByRole("button", { name: "恢复账户" })).toBeVisible({
    timeout: 30_000,
  });
  await shot(adminPage, "03-user-suspended-1440");

  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.waitForLoadState("networkidle");
  await expect(adminPage.getByRole("heading", { name: "用户", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await search.fill(VIEWER_EMAIL);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("button", { name: "恢复账户" })).toBeVisible();

  await row.getByRole("button", { name: "恢复账户" }).click();
  dialog = adminPage.getByRole("dialog", { name: "恢复账户" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("输入用户姓名确认").fill(VIEWER_NAME);
  await dialog.getByRole("button", { name: "确认恢复" }).click();
  await expect(row.getByRole("button", { name: "暂停账户" })).toBeVisible({
    timeout: 30_000,
  });

  await gotoAdmin(adminPage, "/admin/audit", "审计日志");
  await adminPage.getByPlaceholder("例如 admin.user.suspend").fill("admin.user.updated");
  await expect(adminPage.getByText("admin.user.updated").first()).toBeVisible({
    timeout: 30_000,
  });
  const auditDownload = adminPage.waitForEvent("download");
  await adminPage.getByRole("button", { name: "导出 CSV" }).click();
  expect((await auditDownload).suggestedFilename()).toMatch(
    /^roamlog-admin-audit(?:-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})?\.csv$/u,
  );
  await shot(adminPage, "03-user-audit-1440");
});

test("04 suspend and restore the temporary Workspace", async () => {
  test.setTimeout(180_000);
  await gotoAdmin(adminPage, "/admin/workspaces", "工作区");
  const search = adminPage.getByLabel("搜索工作区");
  await search.fill(WORKSPACE_NAME);

  const row = adminPage.getByRole("row", { name: `工作区 ${WORKSPACE_NAME}` }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const workspacesDownload = adminPage.waitForEvent("download");
  await adminPage.getByRole("button", { name: "导出 CSV" }).click();
  expect((await workspacesDownload).suggestedFilename()).toMatch(
    /^roamlog-admin-workspaces(?:-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})?\.csv$/u,
  );

  await row.getByRole("button", { name: "暂停工作区" }).click();

  let dialog = adminPage.getByRole("dialog", { name: "暂停工作区" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("输入工作区名称确认").fill(WORKSPACE_NAME);
  await dialog.getByRole("button", { name: "确认暂停" }).click();
  await expect(row.getByRole("button", { name: "恢复工作区" })).toBeVisible({
    timeout: 30_000,
  });
  await shot(adminPage, "04-workspace-suspended-1440");

  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.waitForLoadState("networkidle");
  await expect(adminPage.getByRole("heading", { name: "工作区", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await search.fill(WORKSPACE_NAME);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("button", { name: "恢复工作区" })).toBeVisible();

  await row.getByRole("button", { name: "恢复工作区" }).click();
  dialog = adminPage.getByRole("dialog", { name: "恢复工作区" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("输入工作区名称确认").fill(WORKSPACE_NAME);
  await dialog.getByRole("button", { name: "确认恢复" }).click();
  await expect(row.getByRole("button", { name: "暂停工作区" })).toBeVisible({
    timeout: 30_000,
  });

  await gotoAdmin(adminPage, "/admin/audit", "审计日志");
  await adminPage.getByPlaceholder("例如 admin.user.suspend").fill("admin.workspace.updated");
  await expect(adminPage.getByText("admin.workspace.updated").first()).toBeVisible({
    timeout: 30_000,
  });
});

test("05 remove and restore reported content with Owner visibility checks", async () => {
  test.setTimeout(240_000);
  await gotoAdmin(adminPage, "/admin/content", "内容审核");
  const search = adminPage.getByLabel("搜索举报");
  await search.fill(ENTRY_TITLE);

  let row = adminPage.getByRole("row").filter({ hasText: ENTRY_TITLE }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "查看详情" }).click();

  let dialog = adminPage.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: ENTRY_TITLE })).toBeVisible({
    timeout: 30_000,
  });
  await dialog.locator("select").selectOption("remove");
  await dialog
    .getByPlaceholder("可选：说明裁决依据，不写入内容正文")
    .fill("生产后台验收：下架内容");
  await dialog.getByRole("button", { name: "提交裁决" }).click();
  await expect(adminPage.getByText("裁决已记录，队列已重新拉取。")).toBeVisible({
    timeout: 30_000,
  });
  await shot(adminPage, "05-report-removed-1440");

  await ownerPage.goto(`${BASE}/w/${WORKSPACE_SLUG}/journal`, {
    waitUntil: "domcontentloaded",
  });
  await expect(ownerPage.getByRole("heading", { name: "全部日志" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(ownerPage.getByText(ENTRY_TITLE)).toHaveCount(0);

  await gotoAdmin(adminPage, "/admin/content", "内容审核");
  await adminPage.getByLabel("搜索举报").fill(ENTRY_TITLE);
  row = adminPage.getByRole("row").filter({ hasText: ENTRY_TITLE }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "查看详情" }).click();

  dialog = adminPage.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: ENTRY_TITLE })).toBeVisible({
    timeout: 30_000,
  });
  await dialog.locator("select").selectOption("restore");
  await dialog
    .getByPlaceholder("可选：说明裁决依据，不写入内容正文")
    .fill("生产后台验收：恢复内容");
  await dialog.getByRole("button", { name: "提交裁决" }).click();
  await expect(adminPage.getByText("裁决已记录，队列已重新拉取。")).toBeVisible({
    timeout: 30_000,
  });
  await shot(adminPage, "05-report-restored-1440");

  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await expect(ownerPage.getByText(ENTRY_TITLE).first()).toBeVisible({
    timeout: 30_000,
  });
});

test("06 media library renders the uploaded image and deletes only that test file", async () => {
  test.setTimeout(180_000);
  await gotoAdmin(adminPage, "/admin/media", "媒体库");
  const search = adminPage.getByPlaceholder("文件名或工作区");
  await search.fill(WORKSPACE_NAME);

  const card = adminPage
    .locator("article")
    .filter({ has: adminPage.getByTestId(`media-thumbnail-${mediaId}`) })
    .first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByTestId(`media-thumbnail-${mediaId}`)).toBeVisible({
    timeout: 30_000,
  });
  const displayName = (await card.locator("h2").innerText()).trim();
  expect(displayName.length).toBeGreaterThan(0);
  await shot(adminPage, "06-media-preview-1440");

  await card.getByRole("button", { name: `删除媒体 ${displayName}` }).click();
  const dialog = adminPage.getByRole("dialog", { name: "删除文件" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("输入文件名确认").fill(displayName);
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(adminPage.getByText(`已删除媒体：${displayName}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(card).toHaveCount(0);

  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.waitForLoadState("networkidle");
  await expect(adminPage.getByRole("heading", { name: "媒体库", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await adminPage.getByPlaceholder("文件名或工作区").fill(WORKSPACE_NAME);
  await expect(adminPage.getByText("没有匹配媒体")).toBeVisible({ timeout: 30_000 });
});

test("07 quick appearance changes persist and default is system", async () => {
  test.setTimeout(120_000);
  await gotoAdmin(adminPage, "/admin", "平台总览");
  await expect(adminPage.locator("html")).toHaveAttribute("data-mode", "system");

  await adminPage.getByRole("button", { name: "主题与深浅色" }).click();
  const lightSave = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/me/appearance",
  );
  await adminPage.getByRole("radio", { name: "浅色", exact: true }).click();
  expect((await lightSave).status()).toBe(200);
  await expect(adminPage.locator("html")).toHaveAttribute("data-mode", "light");
  await shot(adminPage, "07-admin-light-1440");

  if (!(await adminPage.getByRole("radio", { name: "深色", exact: true }).isVisible())) {
    await adminPage.getByRole("button", { name: "主题与深浅色" }).click();
  }
  const darkSave = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/me/appearance",
  );
  await adminPage.getByRole("radio", { name: "深色", exact: true }).click();
  expect((await darkSave).status()).toBe(200);
  await expect(adminPage.locator("html")).toHaveAttribute("data-mode", "dark");
  await adminPage.keyboard.press("Escape");

  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.waitForLoadState("networkidle");
  await expect(adminPage.getByRole("heading", { name: "平台总览", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(adminPage.locator("html")).toHaveAttribute("data-mode", "dark");

  await adminPage.getByRole("button", { name: "主题与深浅色" }).click();
  const systemSave = adminPage.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname === "/v1/me/appearance",
  );
  await adminPage.getByRole("radio", { name: "跟随系统", exact: true }).click();
  expect((await systemSave).status()).toBe(200);
  await expect(adminPage.locator("html")).toHaveAttribute("data-mode", "system");
});

test("08 Analyst and Support permissions are enforced in the UI", async () => {
  test.setTimeout(180_000);
  await gotoAdmin(analystPage, "/admin/users", "用户");
  await expect(analystPage.getByText("分析员只能查看用户数据，不能修改或删除。")).toBeVisible();
  await analystPage.getByLabel("搜索用户").fill(OWNER_EMAIL);
  const analystRow = analystPage.getByRole("row").filter({ hasText: OWNER_EMAIL }).first();
  await expect(analystRow).toBeVisible({ timeout: 30_000 });
  await expect(analystRow.getByRole("button", { name: "暂停账户" })).toBeDisabled();
  await expect(analystRow.getByRole("button", { name: "移入已删除" })).toBeDisabled();
  await analystPage.goto(`${BASE}/admin/content`, { waitUntil: "domcontentloaded" });
  await expect(analystPage.getByText("分析员只能查看举报和处理记录，不能修改。")).toBeVisible({
    timeout: 30_000,
  });
  await shot(analystPage, "08-analyst-readonly-1440");

  await gotoAdmin(supportPage, "/admin/users", "用户");
  await supportPage.getByLabel("搜索用户").fill(OWNER_EMAIL);
  const supportRow = supportPage.getByRole("row").filter({ hasText: OWNER_EMAIL }).first();
  await expect(supportRow).toBeVisible({ timeout: 30_000 });
  await expect(supportRow.getByRole("button", { name: "暂停账户" })).toBeEnabled();
  await expect(supportRow.getByRole("button", { name: "修改平台角色" })).toBeDisabled();
  await expect(supportRow.getByRole("button", { name: "移入已删除" })).toBeDisabled();
  await shot(supportPage, "08-support-limited-1440");
});

test("09 Admin mobile lists and settings do not overflow at 390px", async () => {
  test.setTimeout(180_000);
  const mobile = await adminContext.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });

  await mobile.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
  await mobile.waitForLoadState("networkidle");
  await expect(mobile.getByRole("heading", { name: "用户", level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await noHorizontalOverflow(mobile);
  await mobile.getByRole("button", { name: "打开导航" }).click();
  await expect(mobile.getByRole("link", { name: "工作区", exact: true })).toBeVisible();
  await mobile.keyboard.press("Escape");
  await shot(mobile, "09-mobile-users-390");

  await mobile.goto(`${BASE}/admin/settings?tab=theme`, {
    waitUntil: "domcontentloaded",
  });
  await mobile.waitForLoadState("networkidle");
  await expect(mobile.getByRole("heading", { name: "外观与字体" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await noHorizontalOverflow(mobile);
  await shot(mobile, "09-mobile-settings-390");

  await mobile.close();
});
