import { expect, test } from "../support/fixtures";
import { screenshot, WORKSPACE_PATH } from "../support/helpers";

test("dashboard renders real travel stats and next journey", async ({ page }) => {
  await page.goto(WORKSPACE_PATH);

  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();
  await expect(page.getByText("MSW DEVELOPMENT DATA")).toBeVisible();

  const stats = page.getByRole("region", { name: "旅行统计" });
  await expect(stats).toBeVisible();
  await expect(
    stats.getByText("TOTAL JOURNEYS").locator("..").getByText("9", { exact: true }),
  ).toBeVisible();
  await expect(stats.getByText("COUNTRIES VISITED")).toBeVisible();
  await expect(stats.getByText("DAYS ON THE ROAD")).toBeVisible();

  await expect(page.getByRole("heading", { name: "首尔，晚秋与夜航" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近整理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "预算分布" })).toBeVisible();

  await screenshot(page, "web-1440-dashboard.png");
});

test("desktop sidebar stays pinned while the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(WORKSPACE_PATH);

  const sidebar = page.locator("aside").first();
  await expect(sidebar).toBeVisible();
  const before = await sidebar.boundingBox();
  expect(before).not.toBeNull();

  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
  await page.waitForTimeout(100);

  const after = await sidebar.boundingBox();
  expect(after).not.toBeNull();
  expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
