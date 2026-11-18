import { expect, test } from "../support/fixtures";
import { screenshot, WORKSPACE_PATH } from "../support/helpers";
import { MOCK_TRIP_COUNT } from "../support/mock-fixtures";

test("dashboard renders real travel stats and next journey", async ({ page }) => {
  await page.goto(WORKSPACE_PATH);

  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();

  // Mock mode must label itself. This replaces the removed "MSW DEVELOPMENT DATA"
  // footer marker: the page now carries the "本地演示数据（非真实）" badge plus the
  // explanation that the numbers come from local fixtures, so demo data can never
  // be read as a real travel record.
  await expect(page.getByText("本地演示数据（非真实）")).toBeVisible();
  await expect(
    page.getByText("当前数据来自本地 MSW fixtures，仅用于开发演示，不代表真实旅行记录。"),
  ).toBeVisible();

  const stats = page.getByRole("region", { name: "旅行统计" });
  await expect(stats).toBeVisible();
  await expect(stats.getByText("COUNTRIES VISITED")).toBeVisible();
  await expect(stats.getByText("STOPS COLLECTED")).toBeVisible();
  await expect(stats.getByText("DAYS ON THE ROAD")).toBeVisible();

  // The stat cards aggregate the real trip list, they are not a fixed placeholder.
  // The expected value is derived from the MSW fixtures (not hard-coded) and the
  // remaining cards must at least render an integer.
  const journeys = stats.getByText("TOTAL JOURNEYS").locator("..");
  await expect(journeys.getByText(String(MOCK_TRIP_COUNT), { exact: true })).toBeVisible();

  for (const meta of ["COUNTRIES VISITED", "STOPS COLLECTED", "DAYS ON THE ROAD"]) {
    await expect(stats.getByText(meta).locator("..").getByText(/^\d+$/)).toBeVisible();
  }

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