import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { OWNER_ACCOUNT, WEB_URL } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

/**
 * Settings IA + profile + account security + notifications, against the real
 * stack (web :3000 → API :4000 → PostgreSQL → S3 stub).
 *
 * Every assertion lands on the UI (URL, role, visible text, `img[src]`) or on a
 * real HTTP response. State the account owned before the run is restored in the
 * `finally` blocks so the shared `verify@roamlog.test` account stays reusable.
 */

const WORKSPACE_SLUG = "roamlog-crew";
const SETTINGS_ROOT = `${WEB_URL}/w/${WORKSPACE_SLUG}/settings`;
const AUDIT_DIR = path.join(process.cwd(), ".audit", "settings");
const AVATAR_FIXTURE = path.join(AUDIT_DIR, "fixtures", "avatar.png");

test.describe.configure({ mode: "serial" });

interface MeSnapshot {
  name: string;
  image: string | null;
  timezone: string;
  locale: string;
  email: string;
}

/**
 * Real email/password sign-in with 429 handling.
 *
 * The API caps auth mutations per IP per window (`RATE_LIMIT_WINDOW_SECONDS`,
 * `AUTH_RATE_LIMIT_MAX`); several agents run journeys against this shared stack,
 * so a run can be throttled. `Retry-After` is honoured instead of failing a
 * product assertion on someone else's traffic.
 */
async function login(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await page.request.post("/v1/auth/sign-in/email", {
      headers: { origin: WEB_URL, "content-type": "application/json" },
      data: {
        email: OWNER_ACCOUNT.email,
        password: OWNER_ACCOUNT.password,
        rememberMe: true,
      },
    });
    if (response.ok()) return;
    if (response.status() === 429) {
      const retryAfter = Number(response.headers()["retry-after"] ?? "10");
      const seconds = Number.isFinite(retryAfter) ? retryAfter : 10;
      await page.waitForTimeout(Math.min(65_000, Math.max(5_000, seconds * 1_000)));
      continue;
    }
    throw new Error(`sign-in for ${OWNER_ACCOUNT.email}: ${response.status()} ${await response.text()}`);
  }
  throw new Error("sign-in stayed rate limited after 5 attempts");
}

async function readMe(page: Page): Promise<MeSnapshot> {
  const response = await page.request.get("/v1/me");
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MeSnapshot;
}

async function patchMe(page: Page, data: Record<string, unknown>): Promise<void> {
  const response = await page.request.patch("/v1/me", {
    headers: { origin: WEB_URL, "content-type": "application/json" },
    data,
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(AUDIT_DIR, { recursive: true });
  // Sticky columns are painted at the scroll position the capture starts from;
  // returning to the top keeps the settings nav where a reader expects it.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(AUDIT_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
}


/**
 * Mobile guard that a bare `document.scrollWidth` check cannot catch.
 *
 * The settings layout is a grid; when the section nav's scroll strip grows to its
 * `max-content` width the implicit column widens with it and `main`'s
 * `overflow-x-clip` silently cuts the right edge. `document.scrollWidth` stays at
 * the viewport width in that case, so this asserts the content column and every
 * card inside it against the real viewport instead.
 */
async function expectSettingsContentFits(page: Page, label: string): Promise<void> {
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const content = page.getByTestId("settings-content");
  await expect(content).toBeVisible();

  const metrics = await content.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    right: element.getBoundingClientRect().right,
  }));
  expect
    .soft(metrics.scrollWidth, `${label}: 内容列被撑宽（会被裁切）`)
    .toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect
    .soft(metrics.right, `${label}: 内容列右边界超出视口`)
    .toBeLessThanOrEqual(viewportWidth + 1);

  const cardRights = await content.locator("section, form").evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().right),
  );
  expect
    .soft(Math.max(0, ...cardRights), `${label}: 卡片右边界超出视口`)
    .toBeLessThanOrEqual(viewportWidth + 1);
}


/**
 * Deletes the session this run created, so repeated local runs do not pile up
 * dozens of devices on the shared acceptance account.
 */
async function dropCurrentSession(page: Page): Promise<void> {
  const response = await page.request.get("/v1/auth/get-session");
  if (response.status() !== 200) return;
  const body = (await response.json()) as { session?: { id?: unknown } };
  const id = body.session?.id;
  if (typeof id === "string" && id.length > 0) {
    await page.request.delete(`/v1/me/sessions/${id}`).catch(() => undefined);
  }
}

const sections = [
  { label: "个人资料", segment: "profile" },
  { label: "账号安全", segment: "security" },
  { label: "通知", segment: "notifications" },
  { label: "工作区", segment: "workspace" },
  { label: "危险区", segment: "danger" },
] as const;

test("设置根路径重定向到个人资料，五个分区导航都是真实链接", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);

  await page.goto(SETTINGS_ROOT);
  await page.waitForURL(`${SETTINGS_ROOT}/profile`);
  await expect(page.getByRole("heading", { name: "个人资料", level: 1 })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "设置分区" });
  await expect(nav).toBeVisible();

  for (const section of sections) {
    const link = nav.locator(`a[href="/w/${WORKSPACE_SLUG}/settings/${section.segment}"]`);
    await expect(link, `${section.label} 分区链接`).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(link).toContainText(section.label);
  }

  // 危险区是工作区级：副标题不能写成账号级删除。
  await expect(
    nav.locator(`a[href="/w/${WORKSPACE_SLUG}/settings/danger"]`),
  ).toContainText("导出工作区数据、转移所有权、删除工作区");

  await expect(nav.getByRole("link", { name: /成员/ })).toHaveAttribute(
    "href",
    `/w/${WORKSPACE_SLUG}/members`,
  );

  // Real navigation, not buttons: click two sections and verify the URLs.
  await nav
    .locator(`a[href="/w/${WORKSPACE_SLUG}/settings/security"]`)
    .click();
  await page.waitForURL(`${SETTINGS_ROOT}/security`);
  await expect(page.getByRole("heading", { name: "账号安全", level: 1 })).toBeVisible();

  await nav
    .locator(`a[href="/w/${WORKSPACE_SLUG}/settings/notifications"]`)
    .click();
  await page.waitForURL(`${SETTINGS_ROOT}/notifications`);
  await expect(page.getByRole("heading", { name: "通知", level: 1 })).toBeVisible();

  await capture(page, "01-notifications-1440.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "01-notifications-390.png");
  await expectNoHorizontalOverflow(page, "设置通知 390");
  await expectSettingsContentFits(page, "设置通知 390");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The remaining two sections belong to the workspace owner's task; this spec
  // only proves the nav reaches their real routes.
  await nav.locator(`a[href="/w/${WORKSPACE_SLUG}/settings/workspace"]`).click();
  await page.waitForURL(`${SETTINGS_ROOT}/workspace`);
  await nav.locator(`a[href="/w/${WORKSPACE_SLUG}/settings/danger"]`).click();
  await page.waitForURL(`${SETTINGS_ROOT}/danger`);
  await nav.locator(`a[href="/w/${WORKSPACE_SLUG}/settings/profile"]`).click();
  await page.waitForURL(`${SETTINGS_ROOT}/profile`);

  await dropCurrentSession(page);
});

test("头像上传写入 PATCH /v1/me，显示名称与头像刷新后仍然生效", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const original = await readMe(page);

  try {
    await page.goto(`${SETTINGS_ROOT}/profile`);
    await expect(page.getByRole("heading", { name: "个人资料", level: 1 })).toBeVisible();

    const avatarSection = page.locator('section[aria-label="头像"]');
    await expect(avatarSection).toBeVisible();

    // 1) Upload: the real chain is presign → PUT → complete → PATCH /v1/me.
    const patchResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/me") && response.request().method() === "PATCH",
      { timeout: 60_000 },
    );
    await page.getByTestId("avatar-file-input").setInputFiles(AVATAR_FIXTURE);
    const patch = await patchResponse;
    expect(patch.status(), await patch.text()).toBe(200);
    await expect(page.getByText("头像已更新。")).toBeVisible({ timeout: 30_000 });

    const avatarImage = avatarSection.locator("img");
    await expect
      .poll(async () => (await avatarImage.getAttribute("src")) ?? "", {
        message: "头像 <img> 必须拿到签名 URL",
        timeout: 45_000,
      })
      .toContain("X-Amz-Signature");
    const uploadedSrc = await avatarImage.getAttribute("src");
    await expect(avatarSection.getByRole("button", { name: "替换头像" })).toBeVisible();

    // 2) Display name through the same form.
    const newName = `Verify Owner QA ${Date.now().toString().slice(-6)}`;
    await page.getByLabel(/^显示名称/).fill(newName);
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/me") && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "保存个人资料" }).click();
    const saved = await saveResponse;
    expect(saved.status(), await saved.text()).toBe(200);
    await expect(page.getByText("个人资料已保存。")).toBeVisible();

    // 3) Persistence: reload and read the values back from the API.
    await page.reload();
    await expect(page.getByLabel(/^显示名称/)).toHaveValue(newName, { timeout: 30_000 });
    await expect(avatarSection.locator("img")).toHaveAttribute("src", uploadedSrc ?? "");
    await expect(page.getByText("已验证", { exact: true })).toBeVisible();

    const persisted = await readMe(page);
    expect(persisted.name).toBe(newName);
    expect(persisted.image).toBe(uploadedSrc);

    await capture(page, "02-profile-1440.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "02-profile-390.png");
    await expectNoHorizontalOverflow(page, "个人资料 390");
    await expectSettingsContentFits(page, "个人资料 390");
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await patchMe(page, {
      name: original.name,
      image: original.image,
      timezone: original.timezone,
      locale: original.locale,
    });
    await dropCurrentSession(page);
  }
});

test("账号安全：设备列表有真实条目，改密码错误路径给出错误提示", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto(`${SETTINGS_ROOT}/security`);
  await expect(page.getByRole("heading", { name: "账号安全", level: 1 })).toBeVisible();

  const devices = page.locator('section[aria-label="登录设备"]');
  await expect(devices).toBeVisible();
  const rows = devices.locator("ul > li");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  expect(await rows.count(), "设备列表必须有真实条目").toBeGreaterThan(0);
  await expect(devices.getByText("当前设备").first()).toBeVisible();
  await expect(devices.getByText(/登录于/).first()).toBeVisible();

  // Long lists collapse to the most recent devices; expanding must reveal more.
  const initiallyVisible = await rows.count();
  const expandButton = devices.getByRole("button", { name: /显示其余 \d+ 个设备/ });
  if ((await expandButton.count()) > 0) {
    await expandButton.click();
    await expect.poll(async () => rows.count()).toBeGreaterThan(initiallyVisible);
    await devices.getByRole("button", { name: "收起设备列表" }).click();
    await expect.poll(async () => rows.count()).toBe(initiallyVisible);
  }

  // 2FA entry: the existing full page stays the place that manages enrollment.
  await expect(page.getByRole("link", { name: /管理两步验证/ })).toHaveAttribute(
    "href",
    "/settings/security",
  );

  // Password form: the wrong-current-password path must fail loudly and leave
  // the acceptance account's password untouched.
  const passwordForm = page.locator("form", {
    has: page.getByRole("heading", { name: "修改密码" }),
  });
  await passwordForm.getByLabel(/^当前密码/).fill("Definitely-Wrong-123!");
  await passwordForm.getByLabel(/^新密码/).fill("Another-Pass-123!");
  await passwordForm.getByLabel(/^确认新密码/).fill("Another-Pass-123!");

  const failedChange = page.waitForResponse((response) =>
    response.url().includes("/v1/auth/change-password"),
  );
  await passwordForm.getByRole("button", { name: "修改密码" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("确认修改密码？")).toBeVisible();
  await dialog.getByRole("button", { name: "确认修改密码" }).click();
  expect((await failedChange).status()).toBe(400);
  await expect(page.getByText("当前密码不正确，密码没有修改。")).toBeVisible();

  // Email form exists and demands the current password.
  const emailForm = page.locator("form", {
    has: page.getByRole("heading", { name: "修改邮箱" }),
  });
  await expect(emailForm.getByLabel(/^新邮箱/)).toBeVisible();
  await expect(emailForm.getByLabel(/^当前密码/)).toBeVisible();

  // Account deletion belongs to account security, not the workspace danger zone.
  // It stays disabled until the exact confirmation word is typed, and this spec
  // never executes it (the acceptance account must survive the run).
  const deleteSection = page.locator('section[aria-label="删除账号"]');
  await expect(deleteSection).toBeVisible();
  const deleteButton = deleteSection.getByRole("button", { name: "删除这个账号" });
  await expect(deleteButton).toBeDisabled();
  await deleteSection.getByLabel(/^输入 DELETE/).fill("DELETE");
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog.getByText("确认删除账号？")).toBeVisible();
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await expect(deleteDialog).not.toBeVisible();
  await deleteSection.getByLabel(/^输入 DELETE/).fill("");

  await capture(page, "03-security-1440.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "03-security-390.png");
  await expectNoHorizontalOverflow(page, "账号安全 390");
  await expectSettingsContentFits(page, "账号安全 390");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dropCurrentSession(page);
});

test("通知偏好切换即时保存，刷新后保持", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);

  const preferencesResponse = await page.request.get("/v1/me/notification-preferences");
  expect(preferencesResponse.status(), await preferencesResponse.text()).toBe(200);
  const originalPreferences = (await preferencesResponse.json()) as Array<{
    type: string;
    inApp: boolean;
    email: boolean;
  }>;

  try {
    await page.goto(`${SETTINGS_ROOT}/notifications`);
    await expect(page.getByRole("heading", { name: "通知", level: 1 })).toBeVisible();

    const toggle = page.getByRole("switch", { name: "提及的邮件通知" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    const before = await toggle.getAttribute("aria-checked");

    const patchResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/me/notification-preferences") &&
        response.request().method() === "PATCH",
    );
    await toggle.click();
    const patch = await patchResponse;
    expect(patch.status(), await patch.text()).toBe(200);
    await expect(page.getByText("通知偏好已保存。")).toBeVisible();

    const after = await toggle.getAttribute("aria-checked");
    expect(after, "开关状态必须真的改变").not.toBe(before);

    await page.reload();
    await expect(page.getByRole("switch", { name: "提及的邮件通知" })).toHaveAttribute(
      "aria-checked",
      after ?? "",
      { timeout: 30_000 },
    );

    const persisted = (await (
      await page.request.get("/v1/me/notification-preferences")
    ).json()) as Array<{ type: string; inApp: boolean; email: boolean }>;
    const mention = persisted.find((preference) => preference.type === "mention");
    expect(mention?.email).toBe(after === "true");

    await capture(page, "04-notifications-preferences-1440.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "04-notifications-preferences-390.png");
    await expectNoHorizontalOverflow(page, "通知偏好 390");
    await expectSettingsContentFits(page, "通知偏好 390");
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Restore every type the run may have written back to the default (true/true).
    const restore = (
      originalPreferences.length > 0
        ? originalPreferences
        : [
            { type: "mention", inApp: true, email: true },
            { type: "comment_reply", inApp: true, email: true },
            { type: "comment", inApp: true, email: true },
          ]
    ).map(({ type, inApp, email }) => ({ type, inApp, email }));
    const response = await page.request.patch("/v1/me/notification-preferences", {
      headers: { origin: WEB_URL, "content-type": "application/json" },
      data: { preferences: restore },
    });
    expect(response.status(), await response.text()).toBe(200);
    await dropCurrentSession(page);
  }
});