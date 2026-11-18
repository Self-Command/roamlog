import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/** Journey 8 — both pages stay usable with prefers-reduced-motion: reduce. */

const WORKSPACE = "roamlog-crew";
const TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010";
const NEW_TRIP = `/w/${WORKSPACE}/trips/new`;
const DETAIL = `/w/${WORKSPACE}/trips/${TRIP_ID}`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");

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

test("reduced motion: create page remains fully operable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(NEW_TRIP);
  await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });

  expect(
    await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
  ).toBe(true);

  await page.locator("#trip-title").fill("G3 reduced motion");
  await pickDate(page, "#trip-end-date", "2026-11-24");
  await pickDate(page, "#trip-start-date", "2026-11-20");
  await expect(page.locator("#trip-start-date")).toHaveText("2026年11月20日");
  await expect(page.getByText("共 5 天 · 4 晚").first()).toBeVisible();

  // Nothing important may be stuck at opacity 0 behind an animation.
  const invisible = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("h1, h2, input, button"));
    return nodes
      .filter((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.opacity === "0" && box.width > 0 && box.height > 0;
      })
      .map((node) => node.tagName + "#" + node.id);
  });
  expect(invisible, `elements hidden behind an animation: ${invisible.join(", ")}`).toEqual([]);

  await page.screenshot({
    path: path.join(SHOTS, "reduced-motion.png"),
    animations: "disabled",
  });
});

test("reduced motion: detail tabs still switch content", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(DETAIL);
  await expect(page.getByRole("heading", { name: "首尔，晚秋与夜航" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("tab", { name: "行程", exact: true }).click();
  const panel = page.locator('[role="tabpanel"]:visible').first();
  await expect(panel).toBeVisible();
  expect((await panel.innerText()).trim().length).toBeGreaterThan(30);

  await page.getByRole("tab", { name: "预算", exact: true }).click();
  await expect(page.locator('[role="tabpanel"]:visible').first()).toContainText("花费明细");

  await page.screenshot({
    path: path.join(SHOTS, "reduced-motion-detail.png"),
    animations: "disabled",
  });
});