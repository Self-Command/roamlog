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
