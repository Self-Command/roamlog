import { expect, test } from "@playwright/test";

import { collectConsoleErrors, expectNoUnexpectedConsoleErrors } from "./console";
import { loadStagingFixture } from "./fixture";
import { STAGING_API_URL, STAGING_EVIDENCE_ROOT, STAGING_SHARE_PASSWORD } from "./env";

test.describe("Staging public share and permission denial", () => {
  test("anonymous public share renders without private data", async ({ browser }) => {
    const fixture = loadStagingFixture();
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = collectConsoleErrors(page);

    await page.goto(`/share/${fixture.shares.public.token}`);
    await expect(page.getByRole("heading", { name: fixture.journey.tripTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: fixture.journey.entryTitle })).toBeVisible();
    await expect(page.getByText("同行者的话")).toHaveCount(0);
    await expect(page.getByText(fixture.web.email)).toHaveCount(0);
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/public-share-desktop.png`,
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/public-share-mobile.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport + 1);
    expectNoUnexpectedConsoleErrors(errors);
    await context.close();
  });

  test("password gate rejects a wrong password and accepts the correct one", async ({
    browser,
  }) => {
    const fixture = loadStagingFixture();
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = collectConsoleErrors(page);

    await page.goto(`/share/${fixture.shares.password.token}`);
    await expect(page.getByRole("heading", { name: "输入分享密码" })).toBeVisible();
    await page.getByLabel("分享密码").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "打开分享" }).click();
    await expect(page.getByText("密码不正确，请重新输入。")).toBeVisible();

    await page.getByLabel("分享密码").fill(STAGING_SHARE_PASSWORD);
    await page.getByRole("button", { name: "打开分享" }).click();
    await expect(page.getByRole("heading", { name: fixture.journey.tripTitle })).toBeVisible();
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/public-share-password.png`,
      fullPage: true,
    });
    expectNoUnexpectedConsoleErrors(errors, {
      allowShareHttpErrors: true,
      allowAuthSessionHttpErrors: true,
    });
    await context.close();
  });

  test("expired and revoked share links are indistinguishable from missing links", async ({
    browser,
  }) => {
    const fixture = loadStagingFixture();
    const context = await browser.newContext();
    const errors: ReturnType<typeof collectConsoleErrors> = [];

    for (const share of [fixture.shares.expired, fixture.shares.revoked]) {
      const page = await context.newPage();
      const pageErrors = collectConsoleErrors(page);
      errors.push(...pageErrors);
      await page.goto(`/share/${share.token}`);
      await expect(page.getByText("这个分享链接已失效")).toBeVisible();
      await page.screenshot({
        path: `${STAGING_EVIDENCE_ROOT}/share-unavailable-${share === fixture.shares.expired ? "expired" : "revoked"}.png`,
        fullPage: true,
      });
      await page.close();
    }

    const missing = await context.request.get(
      `${STAGING_API_URL}/v1/public/trips/${"a".repeat(43)}`,
    );
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expectNoUnexpectedConsoleErrors(errors, {
      allowShareHttpErrors: true,
      allowAuthSessionHttpErrors: true,
    });
    await context.close();
  });

  test("cross-tenant trip access is denied without leaking tenant data", async ({ request }) => {
    const fixture = loadStagingFixture();
    const headers = {
      cookie: fixture.web.sessionCookie,
      origin: "http://127.0.0.1:3100",
    };

    const read = await request.get(`${STAGING_API_URL}/v1/trips/${fixture.outsider.tripId}`, {
      headers,
    });
    expect(read.status()).toBe(404);
    expect(await read.json()).toMatchObject({ status: 404 });

    const write = await request.patch(`${STAGING_API_URL}/v1/trips/${fixture.outsider.tripId}`, {
      headers,
      data: { version: 1, title: "staging IDOR attempt" },
    });
    expect(write.status()).toBe(404);

    const share = await request.post(
      `${STAGING_API_URL}/v1/trips/${fixture.outsider.tripId}/share-links`,
      { headers, data: {} },
    );
    expect(share.status()).toBe(404);
  });
});
