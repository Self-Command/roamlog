import { expect, test } from "../support/fixtures";
import { KYOTO_TRIP_PATH, screenshot } from "../support/helpers";

test("itinerary toggles completion and creates a new item", async ({ page }) => {
  await page.goto(KYOTO_TRIP_PATH);
  await page.getByRole("tab", { name: "行程" }).click();

  const completedItem = page.getByRole("checkbox", { name: "完成南禅寺清晨散步" });
  await expect(completedItem).toBeChecked();
  await completedItem.click();
  await expect(completedItem).not.toBeChecked();

  await page.getByRole("button", { name: "添加行程" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("行程标题").fill("E2E 夜游鸭川");
  await dialog.getByLabel("地点").fill("鸭川河岸");
  await dialog.getByRole("button", { name: "加入行程" }).click();

  await expect(page.getByText("E2E 夜游鸭川")).toBeVisible();
  await screenshot(page, "web-1440-itinerary.png");
});

test("budget records a new expense", async ({ page }) => {
  await page.goto(KYOTO_TRIP_PATH);
  await page.getByRole("tab", { name: "预算" }).click();

  await page.getByRole("button", { name: "记一笔" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("金额（元）").fill("128.50");
  await dialog.getByLabel("备注").fill("E2E 抹茶与和果子");
  await dialog.getByRole("button", { name: "保存花费" }).click();

  await expect(page.getByText("E2E 抹茶与和果子")).toBeVisible();
  await screenshot(page, "web-1440-budget.png");
});

test("packing checklist can be checked", async ({ page }) => {
  await page.goto(KYOTO_TRIP_PATH);
  await page.getByRole("tab", { name: "打包" }).click();

  const item = page.getByRole("checkbox", { name: "防风外套" });
  await expect(item).not.toBeChecked();
  await item.click();
  await expect(item).toBeChecked();
});
