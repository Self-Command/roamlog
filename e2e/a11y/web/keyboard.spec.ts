import { expect, test } from "@playwright/test";

import {
  expectFocusInsideDialog,
  expectFocusRemainsInsideDialog,
  expectKeyboardTabOrder,
  gotoAndWait,
  KYOTO_TRIP_PATH,
  WEB_ROUTES,
} from "../support";

test("@keyboard web shell follows visible DOM order and shows a focus indicator", async ({
  page,
}) => {
  await gotoAndWait(page, WEB_ROUTES[0]!);
  await expectKeyboardTabOrder(page);
});

test("@keyboard web command palette traps focus, filters, and closes with Escape", async ({
  page,
}) => {
  await gotoAndWait(page, WEB_ROUTES[0]!);
  const trigger = page.getByRole("button", { name: "搜索或运行命令" });
  await trigger.focus();
  await page.keyboard.press("Control+K");

  const dialog = page.getByRole("dialog", { name: "搜索与快捷命令" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "搜索命令" });
  await expect(search).toBeFocused();
  await search.fill("旅行库");
  await expect(dialog.getByText("打开旅行库", { exact: true })).toBeVisible();
  await expectFocusRemainsInsideDialog(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("@keyboard web trip tabs support roving focus and activation", async ({ page }) => {
  await gotoAndWait(page, {
    path: KYOTO_TRIP_PATH,
    heading: "京都红叶慢行",
  });

  const overview = page.getByRole("tab", { name: "概览" });
  const journal = page.getByRole("tab", { name: "日志" });
  const activity = page.getByRole("tab", { name: "活动" });
  await overview.focus();
  await expect(overview).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(journal).toBeFocused();
  await expect(journal).toHaveAttribute("data-state", "active");

  await page.keyboard.press("End");
  await expect(activity).toBeFocused();
  await expect(activity).toHaveAttribute("data-state", "active");

  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute("data-state", "active");
});

test("@keyboard web edit dialog traps focus and restores the trigger", async ({ page }) => {
  await gotoAndWait(page, {
    path: KYOTO_TRIP_PATH,
    heading: "京都红叶慢行",
  });

  const trigger = page.getByRole("button", { name: "编辑旅行" }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "编辑旅行" });
  await expect(dialog).toBeVisible();
  await expectFocusInsideDialog(page);
  await expectFocusRemainsInsideDialog(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test.describe("390px mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("@keyboard web mobile navigation sheet traps focus and closes with Escape", async ({
    page,
  }) => {
    await gotoAndWait(page, WEB_ROUTES[0]!);
    const trigger = page.getByRole("button", { name: "打开导航" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "工作区导航" });
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    await expectFocusRemainsInsideDialog(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
