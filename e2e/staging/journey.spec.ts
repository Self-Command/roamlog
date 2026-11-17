import { expect, test } from "@playwright/test";

import { collectConsoleErrors, expectNoUnexpectedConsoleErrors } from "./console";
import { loadStagingFixture } from "./fixture";
import { STAGING_API_URL, STAGING_EVIDENCE_ROOT } from "./env";

test.describe("Staging real-API journey", () => {
  test("login, create a trip through the UI, and read it back from the API", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = loadStagingFixture();
    const errors = collectConsoleErrors(page);

    await page.goto("/login");
    await page.getByLabel("邮箱").fill(fixture.web.email);
    await page.getByLabel("密码").fill(fixture.web.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL(`**/w/${fixture.web.workspace.slug}`);
    await expect(page.getByRole("heading", { name: "旅行总览" })).toBeVisible();

    const me = await page.request.get(`${STAGING_API_URL}/v1/me`);
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({
      id: fixture.web.id,
      email: fixture.web.email,
    });

    await page.goto(`/w/${fixture.web.workspace.slug}/trips`);
    await expect(page.getByRole("heading", { name: "旅行库", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "新建旅行" }).first().click();
    await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible();

    const title = `Staging UI Journey ${fixture.runId}`;
    await page.getByLabel("标题").fill(title);
    await page.getByLabel("摘要").fill("Created through the staging browser + API boundary.");
    await page.getByLabel("出发日期").fill("2027-05-02");
    await page.getByLabel("返回日期").fill("2027-05-08");
    await page.getByRole("button", { name: "创建旅行" }).click();
    await page.waitForURL(/\/w\/.+\/trips\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("VERSION 1")).toBeVisible();
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/journey-trip-desktop.png`,
      fullPage: true,
    });

    const tripIdMatch = page.url().match(/\/trips\/([0-9a-f-]+)$/u);
    expect(tripIdMatch, "created trip URL must include the API trip id").not.toBeNull();
    const created = await page.request.get(`${STAGING_API_URL}/v1/trips/${tripIdMatch?.[1] ?? ""}`);
    expect(created.status()).toBe(200);
    expect(await created.json()).toMatchObject({ id: tripIdMatch?.[1], title, version: 1 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/journey-trip-mobile.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport + 1);
    expectNoUnexpectedConsoleErrors(errors);
  });
});
