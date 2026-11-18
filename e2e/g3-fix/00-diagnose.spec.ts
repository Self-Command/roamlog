import { expect, test } from "@playwright/test";

/**
 * Diagnostic probe (G3_FIX_VERIFY).
 *
 * Answers two environment questions before writing the real assertions:
 *  1. Does `page.route()` intercept the `/v1/places/search` request when the
 *     app runs its MSW service worker? (G3 reported it did not.)
 *  2. Does the page actually reach an interactive create form on :3500?
 */
test("diagnose: route interception + page readiness", async ({ page }) => {
  const requests: string[] = [];
  const responses: string[] = [];
  let routeHits = 0;

  page.on("request", (request) => {
    if (request.url().includes("/v1/places")) requests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.url().includes("/v1/places")) responses.push(`${response.status()} ${response.url()}`);
  });

  await page.route("**/v1/places/search**", async (route) => {
    routeHits += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "UPSTREAM_ERROR", message: "Internal Server Error" }),
    });
  });

  await page.goto("/w/roamlog-crew/trips/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "创建旅行" })).toBeVisible({ timeout: 60_000 });

  const combobox = page.getByRole("combobox", { name: "旅行起点" });
  await combobox.fill("京都");
  await page.waitForTimeout(3000);

  const listbox = page.locator('[role="listbox"]').first();
  const listboxText = (await listbox.count()) > 0 ? await listbox.innerText() : "<no listbox>";
  const bodyText = await page.locator("body").innerText();

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        routeHits,
        requests,
        responses,
        listboxText,
        bodyHasPreparing: bodyText.includes("正在准备本地旅行数据"),
        bodyHead: bodyText.slice(0, 400),
      },
      null,
      2,
    ),
  );

  await page.screenshot({ path: ".audit/evidence/g3-fix/shots/diagnose.png", fullPage: false });
  expect(routeHits).toBeGreaterThanOrEqual(0);
});