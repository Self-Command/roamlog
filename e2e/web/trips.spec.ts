import { expect, test } from "../support/fixtures";
import { KYOTO_TRIP_PATH, screenshot, WORKSPACE_PATH } from "../support/helpers";

test("trip library supports text search and status filtering", async ({ page }) => {
  await page.goto(`${WORKSPACE_PATH}/trips`);

  await expect(page.getByRole("heading", { name: "旅行库" })).toBeVisible();
  await expect(page.getByText("SHOWING 9 OF 9")).toBeVisible();

  const search = page.getByLabel("搜索旅行");
  await search.fill("京都");
  await expect(page.getByText("SHOWING 1 OF 9")).toBeVisible();
  await expect(page.getByRole("heading", { name: "京都红叶慢行" })).toBeVisible();

  await search.fill("");
  await page.getByRole("button", { name: /^愿望/ }).click();
  await expect(page.getByText("SHOWING 2 OF 9")).toBeVisible();
  await expect(page.getByRole("heading", { name: "阿马尔菲海岸愿望单" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "巴塔哥尼亚穿越" })).toBeVisible();

  await screenshot(page, "web-1440-trips-filtered.png");
});

test("trip detail switches across overview, journal, itinerary, budget, and packing", async ({
  page,
}) => {
  await page.goto(KYOTO_TRIP_PATH);

  await expect(page.getByRole("heading", { name: "京都红叶慢行" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "概览" })).toHaveAttribute("data-state", "active");

  await page.getByRole("tab", { name: "日志" }).click();
  await expect(page.getByRole("heading", { name: /京都红叶慢行 · 日志/ })).toBeVisible();

  await page.getByRole("tab", { name: "行程" }).click();
  await expect(page.getByRole("heading", { name: "按日期整理" })).toBeVisible();

  await page.getByRole("tab", { name: "预算" }).click();
  await expect(page.getByRole("heading", { name: "花费明细" })).toBeVisible();

  await page.getByRole("tab", { name: "打包" }).click();
  await expect(page.getByRole("heading", { name: "出发前清单" })).toBeVisible();

  await screenshot(page, "web-1440-trip-detail-packing.png");
});
