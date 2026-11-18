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
 * V1 (P0) — a failed place search must still let the person save a manual
 * origin. The pre-fix behaviour rendered `options` only in the `ready` state,
 * so after a 500 the field could never be filled (G3 FAIL-2).
 *
 * Failure injection: `page.route()` is registered as requested, but the app
 * serves `/v1/*` from its MSW service worker, so the handler records 0 hits;
 * the fetch-level shim (same payload) is what the request actually meets. Both
 * hit counts are asserted/logged so the evidence is honest. See the report.
 */
test.describe("V1 manual origin fallback", () => {
  test("V1a: with a 500 the manual fallback is visible, clickable, and selects a manual place", async ({
    page,
  }) => {
    const stats = await installPlaceSearchFailure(page, "json500");
    await gotoNewTrip(page);

    const combobox = originCombobox(page);
    await combobox.fill("京都");

    const listbox = originListbox(page);
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("status")).toContainText("地点搜索暂时不可用");

    // The error block and its retry action survive the fallback row (not replaced).
    await expect(listbox.getByRole("button", { name: "重试" })).toBeVisible();

    const manual = listbox.getByRole("option", { name: "使用「京都」作为起点" });
    await expect(manual).toBeVisible();
    await expect(manual).toHaveAttribute("aria-selected", "true");

    const listboxTextBefore = await listbox.innerText();
    await focusOriginField(page);
    await page.screenshot({ path: `${SHOTS}/manual-fallback-500-state.png` });
    await listbox.screenshot({ path: `${SHOTS}/v1-manual-fallback-listbox-500.png` });
    await listbox.screenshot({ path: `${SHOTS}/v1-manual-fallback-listbox-500.png` });

    await manual.click();

    // Manual selection writes provider=local: badge + null coordinates.
    await expect(combobox).toHaveValue("京都");
    await expect(page.getByText("手动地点", { exact: true })).toBeVisible();
    await expect(page.getByText("坐标为空", { exact: true })).toBeVisible();
    await expect(page.getByText("地点库", { exact: true })).toHaveCount(0);
    await expect(listbox).toBeHidden();

    const observed = await stats();
    writeLog("v1a-manual-click.json", {
      observed,
      listboxTextBefore,
      originInputValue: await combobox.inputValue(),
      manualBadgeVisible: await page.getByText("手动地点", { exact: true }).isVisible(),
    });

    // The shim proves the request was intercepted; page.route is the no-op layer.
    expect(observed.shimHits).toBeGreaterThanOrEqual(1);
    expect(observed.routeHits).toBe(0);
    await page.screenshot({ path: `${SHOTS}/v1-manual-selected-click.png` });
  });

  test("V1b: Enter selects the manual fallback (activeIndex points at the manual row)", async ({
    page,
  }) => {
    const stats = await installPlaceSearchFailure(page, "json500");
    await gotoNewTrip(page);

    const combobox = originCombobox(page);
    await combobox.fill("京都");
    const listbox = originListbox(page);
    await expect(listbox.getByRole("option", { name: "使用「京都」作为起点" })).toBeVisible();

    // The combobox keeps aria-activedescendant on the manual row after the failure.
    const activeDescendant = await combobox.getAttribute("aria-activedescendant");
    expect(activeDescendant).toBeTruthy();
    const activeText = await page.evaluate(
      (id) => document.getElementById(id)?.textContent ?? "",
      activeDescendant,
    );
    expect(activeText).toContain("使用「京都」作为起点");
    expect(await page.locator(`#${activeDescendant}`).getAttribute("aria-selected")).toBe("true");

    await combobox.press("Enter");

    await expect(combobox).toHaveValue("京都");
    await expect(page.getByText("手动地点", { exact: true })).toBeVisible();
    await expect(page.getByText("坐标为空", { exact: true })).toBeVisible();
    await expect(listbox).toBeHidden();

    const observed = await stats();
    writeLog("v1b-keyboard-enter.json", {
      observed,
      activeDescendant,
      activeText,
      originInputValue: await combobox.inputValue(),
    });
    expect(observed.shimHits).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: `${SHOTS}/v1-manual-selected-keyboard.png` });
  });
});