import { expect, test } from "@playwright/test";

import {
  SHOTS,
  focusOriginField,
  gotoNewTrip,
  installPlaceSearchFailure,
  originCombobox,
  originListbox,
  writeLog,
} from "./support/harness";

/**
 * V2 (P1) — the failure copy must never echo the raw exception. Pre-fix the DOM
 * received `API request to /v1/places/search failed with status 500` and
 * `Unexpected token 'I', "Internal S"... is not valid JSON` (G3 finding 1).
 */
const FORBIDDEN = ["500", "/v1/", "Unexpected token", "Internal Server"] as const;

function leakReport(text: string): Array<{ fragment: string; present: boolean }> {
  return FORBIDDEN.map((fragment) => ({ fragment, present: text.includes(fragment) }));
}

async function assertNoLeak(listboxText: string, bodyText: string): Promise<void> {
  for (const fragment of FORBIDDEN) {
    expect(listboxText).not.toContain(fragment);
    expect(bodyText).not.toContain(fragment);
  }
}

test.describe("V2 failure copy", () => {
  test("V2a: a 500 renders fixed copy and leaks no status, path or parser output", async ({ page }) => {
    const stats = await installPlaceSearchFailure(page, "json500");
    await gotoNewTrip(page);

    const combobox = originCombobox(page);
    await combobox.fill("京都");
    const listbox = originListbox(page);
    await expect(listbox.getByRole("option", { name: "使用「京都」作为起点" })).toBeVisible();

    const listboxText = await listbox.innerText();
    const bodyText = await page.locator("body").innerText();
    await assertNoLeak(listboxText, bodyText);

    // The classified 500 is "unavailable": the location-specific fixed label.
    expect(listboxText).toContain("地点搜索暂时不可用，你可以直接输入地点名称。");
    expect(listboxText).toContain("重试");

    const observed = await stats();
    writeLog("v2a-json500-no-leak.json", {
      observed,
      listboxText,
      listboxForbiddenCheck: leakReport(listboxText),
      bodyForbiddenCheck: leakReport(bodyText),
      bodyLength: bodyText.length,
    });

    await focusOriginField(page);
    await page.screenshot({ path: `${SHOTS}/manual-fallback-with-500.png` });
    await listbox.screenshot({ path: `${SHOTS}/v2-listbox-with-500.png` });
  });

  test("V2b: an aborted (offline) request renders the fixed network copy", async ({ page }) => {
    const stats = await installPlaceSearchFailure(page, "network-error");
    await gotoNewTrip(page);

    const combobox = originCombobox(page);
    await combobox.fill("京都");
    const listbox = originListbox(page);
    await expect(listbox.getByRole("option", { name: "使用「京都」作为起点" })).toBeVisible();

    const listboxText = await listbox.innerText();
    const bodyText = await page.locator("body").innerText();
    await assertNoLeak(listboxText, bodyText);

    expect(listboxText).toContain("网络连接中断，请检查网络后重试，或直接输入地点名称。");
    await expect(listbox.getByRole("button", { name: "重试" })).toBeVisible();
    // Keyboard path still works after a hard network failure.
    await expect(listbox.getByRole("option", { name: "使用「京都」作为起点" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const observed = await stats();
    writeLog("v2b-offline-no-leak.json", {
      observed,
      listboxText,
      listboxForbiddenCheck: leakReport(listboxText),
      bodyForbiddenCheck: leakReport(bodyText),
    });
    await focusOriginField(page);
    await page.screenshot({ path: `${SHOTS}/v2-manual-fallback-offline.png` });
  });

  test("V2c: the real unmocked 500 (dev proxy, HTML body) also leaks nothing", async ({ page }) => {
    // No interception at all: MSW bypasses `/v1/places/search`, the Next dev
    // rewrite targets the stopped API on :4000 and the response is a 500 HTML
    // page, i.e. exactly the shape that used to surface "Unexpected token 'I'".
    await gotoNewTrip(page);

    const combobox = originCombobox(page);
    await combobox.fill("京都");
    const listbox = originListbox(page);
    await expect(listbox.getByRole("option", { name: "使用「京都」作为起点" })).toBeVisible();

    const listboxText = await listbox.innerText();
    const bodyText = await page.locator("body").innerText();
    await assertNoLeak(listboxText, bodyText);

    expect(listboxText).toContain("地点搜索返回异常，你可以直接输入地点名称。");
    writeLog("v2c-real-500-no-leak.json", {
      listboxText,
      listboxForbiddenCheck: leakReport(listboxText),
      bodyForbiddenCheck: leakReport(bodyText),
    });
    await focusOriginField(page);
    await page.screenshot({ path: `${SHOTS}/v2-real-500.png` });
  });

  test("V2d: a real browser-level network drop (context offline) keeps the fixed copy", async ({
    page,
    context,
  }) => {
    // `route.abort("failed")` cannot reach this app's fetches (MSW service
    // worker owns `/v1/*`), so the browser's own offline switch is used: it
    // fails the real network call under the worker, i.e. a genuine drop.
    await gotoNewTrip(page);
    const combobox = originCombobox(page);
    await context.setOffline(true);
    try {
      await combobox.fill("京都");
      const listbox = originListbox(page);
      await expect(listbox.getByRole("option", { name: "使用「京都」作为起点" })).toBeVisible();

      const listboxText = await listbox.innerText();
      const bodyText = await page.locator("body").innerText();
      await assertNoLeak(listboxText, bodyText);
      expect(listboxText).toContain("网络连接中断，请检查网络后重试，或直接输入地点名称。");
      await expect(listbox.getByRole("button", { name: "重试" })).toBeVisible();

      writeLog("v2d-real-offline.json", {
        listboxText,
        listboxForbiddenCheck: leakReport(listboxText),
        bodyForbiddenCheck: leakReport(bodyText),
      });
      await focusOriginField(page);
      await page.screenshot({ path: `${SHOTS}/v2-real-offline.png` });
    } finally {
      await context.setOffline(false);
    }
  });
});