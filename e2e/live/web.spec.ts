import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, loginOnWeb } from "../live-support/browser";
import { loadLiveFixture } from "../live-support/fixture";

test.describe("Web live API journey", () => {
  test("login, /v1/me, workspace, create trip, write entry and comment", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = loadLiveFixture();

    await loginOnWeb(page, fixture);

    const me = await page.request.get("/v1/me");
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({
      email: fixture.web.email,
      id: fixture.web.id,
    });

    const workspaces = await page.request.get("/v1/me/workspaces");
    expect(workspaces.status()).toBe(200);
    expect(await workspaces.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.web.workspace.id,
          slug: fixture.web.workspace.slug,
          role: "owner",
        }),
      ]),
    );

    await page.goto(`/w/${fixture.web.workspace.slug}/trips`);
    await expect(page.getByRole("heading", { name: "旅行库", exact: true })).toBeVisible();
    await expect(page.getByText("旅行库还是空的")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "新建旅行" }).first().click();
    await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible();
    const tripTitle = `W5 Live Journey ${fixture.runId}`;
    await page.getByLabel("标题").fill(tripTitle);
    await page.getByLabel("摘要").fill("Created by the isolated Wave 5 real-API browser test.");
    await page.getByLabel("出发日期").fill("2027-03-12");
    await page.getByLabel("返回日期").fill("2027-03-18");
    await page.getByRole("button", { name: "创建旅行" }).click();
    await page.waitForURL(/\/w\/.+\/trips\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: tripTitle })).toBeVisible();
    await expect(page.getByText("VERSION 1")).toBeVisible();
    await page.screenshot({
      path: "test-results/live/web-trip-detail.png",
      fullPage: true,
    });

    await page.goto(`/w/${fixture.web.workspace.slug}/journal`);
    await expect(page.getByRole("heading", { name: "全部日志" })).toBeVisible();
    await page.getByRole("button", { name: "写日志" }).click();
    await expect(page.getByText("NEW JOURNAL ENTRY")).toBeVisible();

    const entrySheet = page.getByRole("dialog");
    const entryTitle = `First live entry ${fixture.runId}`;
    await entrySheet.getByRole("textbox", { name: "标题", exact: true }).fill(entryTitle);
    await entrySheet.getByLabel("日期", { exact: true }).fill("2027-03-14");
    await entrySheet.getByRole("textbox", { name: "地点", exact: true }).fill("Kyoto");
    await entrySheet
      .getByRole("textbox", { name: "日志正文", exact: true })
      .fill("A real entry written through the live API boundary.");
    await entrySheet.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("heading", { name: entryTitle })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(entryTitle) }).click();
    await expect(page.getByText("同行者的话")).toBeVisible();
    const comment = `Live comment ${fixture.runId}`;
    await page.getByLabel("评论内容").fill(comment);
    await page.getByRole("button", { name: "发送评论" }).click();
    await expect(page.getByText(comment)).toBeVisible();
    await page.screenshot({
      path: "test-results/live/web-entry-comment.png",
      fullPage: true,
    });
  });
});
