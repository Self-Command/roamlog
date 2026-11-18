import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** Journey 6 — layout must not overflow horizontally at 390 / 820 / 1440. */

const WORKSPACE = "roamlog-crew";
const TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010";
const NEW_TRIP = `/w/${WORKSPACE}/trips/new`;
const DETAIL = `/w/${WORKSPACE}/trips/${TRIP_ID}`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");
const LOGS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/logs");

const SIZES = [
  { width: 390, height: 844 },
  { width: 820, height: 900 },
  { width: 1440, height: 900 },
];

async function assertNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  fs.mkdirSync(LOGS, { recursive: true });
  fs.appendFileSync(
    path.join(LOGS, "responsive-overflow.jsonl"),
    JSON.stringify({ label, ...metrics }) + "\n",
  );
  expect(
    metrics.scrollWidth,
    `${label}: documentElement.scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
  return metrics;
}

test("responsive: create page does not overflow at 390 / 820 / 1440", async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(NEW_TRIP);
    await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);
    await assertNoOverflow(page, `create-${size.width}`);
    await page.screenshot({
      path: path.join(SHOTS, `responsive-${size.width}-create.png`),
      animations: "disabled",
    });
  }
});

test("responsive: detail page does not overflow at 390 / 820 / 1440", async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.goto(DETAIL);
    await expect(page.getByRole("heading", { name: "首尔，晚秋与夜航" })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(400);
    await assertNoOverflow(page, `detail-${size.width}`);
    await page.screenshot({
      path: path.join(SHOTS, `responsive-${size.width}-detail.png`),
      animations: "disabled",
    });
  }
});