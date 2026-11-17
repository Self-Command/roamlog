import { expect, test } from "@playwright/test";

import {
  ADMIN_ROUTES,
  expectFocusInsideDialog,
  expectFocusRemainsInsideDialog,
  expectKeyboardTabOrder,
  gotoAndWait,
  setAdminRole,
} from "../support";

test("@keyboard admin provides a working skip link and visible tab order", async ({ page }) => {
  await setAdminRole(page);
  await gotoAndWait(page, ADMIN_ROUTES[0]!);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳至主要内容" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#admin-main-content$/);
});

test("@keyboard admin main navigation follows visible DOM order", async ({ page }) => {
  await setAdminRole(page);
  await gotoAndWait(page, ADMIN_ROUTES[0]!);
  await expectKeyboardTabOrder(page);
});

test("@keyboard admin command palette traps focus and closes with Escape", async ({ page }) => {
  await setAdminRole(page);
  await gotoAndWait(page, ADMIN_ROUTES[0]!);

  const trigger = page.getByRole("button", { name: "搜索页面、用户或工作区 K" }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "全局搜索" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "全局搜索查询" });
  await expect(search).toBeFocused();
  await expectFocusRemainsInsideDialog(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("@keyboard admin user sheet traps focus and closes with Escape", async ({ page }) => {
  await setAdminRole(page);
  await gotoAndWait(page, ADMIN_ROUTES[1]!);

  const trigger = page.getByRole("button", { name: "详情" }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectFocusInsideDialog(page);
  await expectFocusRemainsInsideDialog(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("@keyboard admin queue dialog validates and traps focus before Escape", async ({ page }) => {
  await setAdminRole(page);
  await gotoAndWait(page, ADMIN_ROUTES[2]!);

  const trigger = page.getByRole("button", { name: "重试任务" }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "重试任务" });
  await expect(dialog).toBeVisible();
  await expectFocusInsideDialog(page);
  await expectFocusRemainsInsideDialog(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
