import { expect, test } from "../support/fixtures";
import { screenshot, WORKSPACE_PATH } from "../support/helpers";
import { loginOnWeb, OWNER_ACCOUNT } from "../support/accounts";

test("dashboard renders real travel stats and next journey", async ({ page }) => {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(WORKSPACE_PATH);

  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();

  const stats = page.getByRole("region", { name: "旅行统计" });
  await expect(stats).toBeVisible();
  await expect(stats.getByText("到访国家", { exact: true })).toBeVisible();
  await expect(stats.getByText("到访城市", { exact: true })).toBeVisible();
  await expect(stats.getByText("累计天数", { exact: true })).toBeVisible();

  // The stat cards aggregate the real seeded trip list, not a fixed placeholder.
  const journeys = stats.getByText("旅行总数", { exact: true }).locator("..");
  await expect(journeys.getByText(/^\d+$/)).toBeVisible();

  for (const meta of ["到访国家", "到访城市", "累计天数"]) {
    await expect(stats.getByText(meta).locator("..").getByText(/^\d+$/)).toBeVisible();
  }

  const nextJourney = page.locator("section").filter({ hasText: "下一段旅行" }).first();
  await expect(nextJourney).toBeVisible();
  await expect(nextJourney.getByRole("heading")).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近更新" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "预算分布" })).toBeVisible();

  await screenshot(page, "web-1440-dashboard.png");
});

test("desktop sidebar stays pinned while the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(WORKSPACE_PATH);
  await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();

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
