import { expect, test } from "../support/fixtures";
import { WORKSPACE_PATH } from "../support/helpers";
import { loginOnWeb, OWNER_ACCOUNT } from "../support/accounts";

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  await page
    .evaluate(async () => {
      await fetch("/v1/me/appearance", { method: "DELETE" });
    })
    .catch(() => undefined);
});

test("quick appearance menu switches mode and skin and keeps them after reload", async ({
  page,
}) => {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(WORKSPACE_PATH);

  const trigger = page.getByTestId("quick-appearance-trigger");
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByTestId("quick-appearance-menu")).toBeVisible();

  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

  await page.getByRole("radio", { name: /Fluent 2 原生企业/u }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "fluent");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "fluent");
});

test("quick appearance menu fits and works at 390px", async ({ page }) => {
  await loginOnWeb(page, OWNER_ACCOUNT);
  await page.goto(WORKSPACE_PATH);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByTestId("quick-appearance-trigger").click();
  const menu = page.getByTestId("quick-appearance-menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);

  await page.getByRole("radio", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
});
