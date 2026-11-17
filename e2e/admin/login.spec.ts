import { expect, test } from "../support/fixtures";
import { screenshot } from "../support/helpers";

test("admin login placeholder completes the local two-step flow", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "进入平台控制台" })).toBeVisible();
  await expect(page.getByText("LOGIN PLACEHOLDER")).toBeVisible();
  await expect(page.getByText("NOT CONNECTED")).toBeVisible();

  await page.getByLabel("密码").fill("local-only-password");
  await page.getByRole("button", { name: "继续验证" }).click();

  await expect(page.getByRole("heading", { name: "双因素认证" })).toBeVisible();
  await page.getByLabel("6 位验证码").fill("123456");
  await page.getByRole("button", { name: "进入控制台" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible();
  await screenshot(page, "admin-1440-login-placeholder.png");
});
