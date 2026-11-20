import { expect, test, type Page } from "@playwright/test";

import { ACCEPTANCE_API_URL, signUpVerifiedAccount, type AcceptanceUser } from "./support";

async function login(page: Page, user: AcceptanceUser): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  if (!slug) {
    throw new Error(`no workspace slug in ${page.url()}`);
  }
  return slug;
}

function profileForm(page: Page) {
  return page.locator("form").filter({ has: page.getByRole("heading", { name: "账号信息" }) });
}

function profileAlert(page: Page, text: string) {
  return page.locator('p[role="alert"]').filter({ hasText: text });
}

test.describe("profile settings", () => {
  let user: AcceptanceUser;

  test.beforeAll(async () => {
    user = await signUpVerifiedAccount("profile-e2e");
  });

  /**
   * One login covers the whole state matrix. Better Auth rate-limits sign-in by
   * IP, so a separate browser context per assertion would turn this test into a
   * rate-limit test instead of a settings test.
   */
  test("saves identity, persists it, and surfaces validation, 4xx, 5xx, offline and 401", async ({
    page,
  }) => {
    const slug = await login(page, user);
    await page.goto(`/w/${slug}/settings/profile`);
    await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "账号信息" })).toBeVisible();

    const form = profileForm(page);
    const name = form.locator('input[autocomplete="name"]');
    const selects = form.locator("select");
    const save = form.getByRole("button", { name: "保存个人资料" });
    const nextName = `验收改名 ${Date.now().toString(36)}`;

    await name.fill(nextName);
    await selects.nth(0).selectOption("America/New_York");
    await selects.nth(1).selectOption("en-US");
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "个人资料已保存。" })).toBeVisible();

    await page.reload();
    await expect(name).toHaveValue(nextName);
    await expect(selects.nth(0)).toHaveValue("America/New_York");
    await expect(selects.nth(1)).toHaveValue("en-US");

    const me = await page.request.get(`${ACCEPTANCE_API_URL}/v1/me`);
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({
      email: user.email,
      name: nextName,
      timezone: "America/New_York",
      locale: "en-US",
    });

    await page.screenshot({
      path: ".audit/avatar-email/profile-1440.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(name).toHaveValue(nextName);
    await page.screenshot({
      path: ".audit/avatar-email/profile-390.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();

    await name.fill("   ");
    await save.click();
    await expect(profileAlert(page, "显示名称不能为空。")).toBeVisible();

    await page.getByTestId("avatar-file-input").setInputFiles({
      name: "not-an-image.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(
      profileAlert(page, "请选择 JPEG、PNG、WebP、AVIF 或 HEIC 格式的图片。"),
    ).toBeVisible();

    await name.fill(`验收拒绝 ${Date.now().toString(36)}`);
    await page.route("**/v1/me", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://roamlog.app/errors/forbidden",
          title: "Forbidden",
          status: 403,
          detail: "Profile update is not allowed.",
          code: "PROFILE_UPDATE_FORBIDDEN",
        }),
      });
    });
    await save.click();
    await expect(profileAlert(page, "当前账号没有修改个人资料的权限。")).toBeVisible();
    await page.unroute("**/v1/me");

    await page.route("**/v1/me", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://roamlog.app/errors/unavailable",
          title: "Service Unavailable",
          status: 503,
          detail: "Profile storage is temporarily unavailable.",
          code: "PROFILE_STORAGE_UNAVAILABLE",
        }),
      });
    });
    await save.click();
    await expect(profileAlert(page, "个人资料保存失败，请检查网络后重试。")).toBeVisible();
    await page.unroute("**/v1/me");

    await page.route("**/v1/me", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      await route.abort("failed");
    });
    await save.click();
    await expect(
      profileAlert(page, "个人资料保存失败，请检查网络后重试。"),
    ).toBeVisible();
    await page.unroute("**/v1/me");

    // A real expired session is not a generic alert: the app sends the member
    // back to login with a readable destination, where they can sign in again.
    await page.context().clearCookies();
    await save.click();
    await page.waitForURL(/\/login\?next=/);
    await expect(page.getByRole("heading", { name: "回到你的旅行档案" })).toBeVisible();
  });
});
