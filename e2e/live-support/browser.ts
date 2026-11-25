import { expect, type Page } from "@playwright/test";

import { currentTotp, type LiveFixture } from "./fixture";

export async function loginOnWeb(page: Page, fixture: LiveFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(fixture.web.email);
  await page.getByLabel("密码").fill(fixture.web.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(`**/w/${fixture.web.workspace.slug}`);
  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();
}

export async function loginOnAdmin(page: Page, fixture: LiveFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("管理员邮箱").fill(fixture.admin.email);
  await page.getByLabel("密码").fill(fixture.admin.password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "两步验证" })).toBeVisible();
  await page.getByLabel("6 位验证码").fill(currentTotp(fixture.admin.totpSecret));
  await page.getByRole("button", { name: "验证并进入控制台" }).click();
  await page.waitForURL("**/admin");
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, "page must not overflow horizontally").toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
}
