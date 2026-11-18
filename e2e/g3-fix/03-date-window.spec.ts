import { expect, test } from "@playwright/test";

import {
  SHOTS,
  addDays,
  gotoNewTrip,
  inclusiveDays,
  openCalendarDate,
  pickCalendarDate,
  readDurationLabel,
  readPickerDate,
  writeLog,
} from "./support/harness";

/**
 * V3 (P1) — the new-trip date window.
 *
 * Pre-fix: `emptyTripFormValues()` set start = end = today and the start picker
 * had `max={endDate}`, so every future departure date was `aria-disabled` and
 * the user had to edit the return date first (G3 finding 3).
 */
test.describe("V3 date defaults and paired correction", () => {
  test("V3a: the default window is end = start + 6 (7 days inclusive)", async ({ page }) => {
    await gotoNewTrip(page);

    const start = await readPickerDate(page, "trip-start-date");
    const end = await readPickerDate(page, "trip-end-date");

    expect(end).toBe(addDays(start, 6));
    expect(inclusiveDays(start, end)).toBe(7);
    expect(await readDurationLabel(page)).toContain("共 7 天 · 6 晚");
    await expect(page.getByText(/含首尾两天/)).toContainText("共 7 天 · 6 晚");

    writeLog("v3a-default-window.json", { start, end, expectedEnd: addDays(start, 6) });
    await page.screenshot({ path: `${SHOTS}/date-default-7days.png` });
  });

  test("V3b: future start dates are selectable; start past end pushes end; end before start pulls start", async ({
    page,
  }) => {
    await gotoNewTrip(page);
    const start0 = await readPickerDate(page, "trip-start-date");
    const end0 = await readPickerDate(page, "trip-end-date");

    // --- 1) future dates are no longer disabled ---------------------------
    const inWindow = await openCalendarDate(
      page,
      "trip-start-date",
      "选择出发日期",
      addDays(start0, 5),
    );
    expect(await inWindow.getAttribute("aria-disabled")).not.toBe("true");

    // Regression probe: a day past the previous `max={endDate}` (start+6) was
    // unconditionally disabled before the fix.
    const beyondOldMax = page.locator(
      `#date-picker-选择出发日期-${addDays(start0, 10)}`,
    );
    expect(await beyondOldMax.count()).toBe(1);
    expect(await beyondOldMax.getAttribute("aria-disabled")).not.toBe("true");

    const grid = page.getByRole("grid", { name: "选择出发日期" });
    await page.screenshot({ path: `${SHOTS}/date-start-future-selectable.png` });

    // --- 2) picking an in-range future start keeps the end (legal change) --
    await inWindow.click();
    await grid.waitFor({ state: "hidden" });
    const start1 = await readPickerDate(page, "trip-start-date");
    const end1 = await readPickerDate(page, "trip-end-date");
    expect(start1).toBe(addDays(start0, 5));
    expect(end1).toBe(end0);
    expect(inclusiveDays(start1, end1)).toBe(2);
    expect(await readDurationLabel(page)).toContain("共 2 天 · 1 晚");

    // --- 3) start past the end pushes the end (applyTripDateChange) --------
    const start2Target = addDays(start1, 8);
    expect(start2Target > end1).toBe(true);
    const outOfWindow = await openCalendarDate(
      page,
      "trip-start-date",
      "选择出发日期",
      start2Target,
    );
    expect(await outOfWindow.getAttribute("aria-disabled")).not.toBe("true");
    await outOfWindow.click();
    await grid.waitFor({ state: "hidden" });

    const start2 = await readPickerDate(page, "trip-start-date");
    const end2 = await readPickerDate(page, "trip-end-date");
    expect(start2).toBe(start2Target);
    expect(end2).toBe(start2Target);
    expect(end2 >= start2).toBe(true);
    expect(inclusiveDays(start2, end2)).toBe(1);
    expect(await readDurationLabel(page)).toContain("共 1 天 · 0 晚");
    writeLog("v3b-start-future-and-pair.json", {
      start0,
      end0,
      start1,
      end1,
      start2,
      end2,
      start2Target,
    });
    await page.screenshot({ path: `${SHOTS}/date-auto-adjust.png` });

    // --- 4) end before start pulls the start back (always end >= start) ---
    const targetEnd = addDays(start2, -2);
    expect(targetEnd < start2).toBe(true);
    await pickCalendarDate(page, "trip-end-date", "选择返回日期", targetEnd);

    const start3 = await readPickerDate(page, "trip-start-date");
    const end3 = await readPickerDate(page, "trip-end-date");
    expect(start3).toBe(targetEnd);
    expect(end3).toBe(targetEnd);
    expect(end3 >= start3).toBe(true);
    expect(inclusiveDays(start3, end3)).toBe(1);
    expect(await readDurationLabel(page)).toContain("共 1 天 · 0 晚");
    await expect(page.getByText("返回日期需不早于出发日期")).toHaveCount(0);

    writeLog("v3b-end-before-start.json", { targetEnd, start3, end3 });
    await page.screenshot({ path: `${SHOTS}/date-end-before-start.png` });
  });
});