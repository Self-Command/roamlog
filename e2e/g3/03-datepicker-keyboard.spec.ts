import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/** Journey 3 — the date picker is fully operable from the keyboard. */

const WORKSPACE = "roamlog-crew";
const NEW_TRIP = `/w/${WORKSPACE}/trips/new`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name), animations: "disabled" });
}

async function openCreate(page: Page) {
  await page.goto(NEW_TRIP);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });
}

async function pickDate(page: Page, trigger: string, iso: string) {
  await page.locator(trigger).click();
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  const day = String(Number(iso.slice(8)));
  await grid
    .locator('[role="gridcell"]:not([aria-hidden="true"]):not([aria-disabled="true"])')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first()
    .click();
  await expect(grid).toBeHidden();
}

test("datepicker: Tab -> Enter -> arrows -> Enter selects, Esc closes and restores focus", async ({
  page,
}) => {
  await openCreate(page);
  // Widen the end date first: the start picker clamps to `max = endDate`, whose
  // default is today, which would block arrow movement.
  await pickDate(page, "#trip-end-date", "2026-11-28");

  await page.locator("#trip-title").focus();

  // 1. Tab to the trigger.
  let reached = false;
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.id ?? "");
    if (id === "trip-start-date") {
      reached = true;
      break;
    }
  }
  expect(reached, "tabbing should reach the 出发日期 trigger").toBe(true);
  await shot(page, "datepicker-keyboard-tab.png");

  // 2. Enter opens the calendar and moves focus into the grid.
  await page.keyboard.press("Enter");
  const grid = page.getByRole("grid").first();
  await expect(grid).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("grid");

  const before = await grid.getAttribute("aria-activedescendant");
  expect(before, "grid must expose aria-activedescendant").toMatch(
    /date-picker-.+-\d{4}-\d{2}-\d{2}$/,
  );

  // 3. Arrow keys move the active day.
  await page.keyboard.press("ArrowRight");
  const afterRight = await grid.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  const afterDown = await grid.getAttribute("aria-activedescendant");
  expect(afterRight, "ArrowRight must move the active day").not.toBe(before);
  expect(afterDown, "ArrowDown must move the active day").not.toBe(afterRight);
  await shot(page, "datepicker-keyboard.png");

  const focusedDay = afterDown?.split("-").slice(-3).join("-") ?? "";
  const [year, month, day] = focusedDay.split("-").map(Number);
  expect(Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)).toBe(true);

  // 4. Enter commits the active day and closes the popover.
  await page.keyboard.press("Enter");
  await expect(grid).toBeHidden();
  await expect(page.locator("#trip-start-date")).toHaveText(`${year}年${month}月${day}日`);

  // 5. Reopen, then Esc closes without changing the value; focus returns to the trigger.
  await page.locator("#trip-start-date").focus();
  await page.keyboard.press("Enter");
  await expect(grid).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid).toBeHidden();
  await expect(page.locator("#trip-start-date")).toHaveText(`${year}年${month}月${day}日`);
  const focusId = await page.evaluate(() => document.activeElement?.id ?? null);
  expect(focusId, "Esc should restore focus to the date trigger").toBe("trip-start-date");

  // The ring must be visible on the trigger while focused.
  const ring = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });
  expect(ring.focusVisible).toBe(true);
  expect(
    ring.boxShadow !== "none" ||
      (ring.outlineStyle !== "none" && ring.outlineWidth !== "0px"),
  ).toBe(true);
});