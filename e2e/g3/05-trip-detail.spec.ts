import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Journey 5 — trip detail workbench.
 *
 * Two separate facts are asserted:
 *  - Which tab set the route actually mounts in mock mode (the data-mode gate in
 *    app/(app)/w/[workspaceSlug]/trips/[tripId]/page.tsx renders the legacy
 *    detail unless NEXT_PUBLIC_DATA_MODE=api).
 *  - That every mounted tab renders real components (headings + data rows or an
 *    explicit empty state), never a gradient/skeleton placeholder.
 */

const WORKSPACE = "roamlog-crew";
const TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010"; // 首尔，晚秋与夜航
const DETAIL = `/w/${WORKSPACE}/trips/${TRIP_ID}`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");
const LOGS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/logs");

const EXPECTED_WORKBENCH_TABS = ["行程", "照片", "费用", "行李", "分享", "参与者", "活动"];

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name), animations: "disabled" });
}

async function openDetail(page: Page) {
  await page.goto(DETAIL);
  await expect(page.getByRole("heading", { name: "首尔，晚秋与夜航" })).toBeVisible({
    timeout: 30_000,
  });
}

test("detail: the seven-tab workbench is reachable in mock mode", async ({ page }) => {
  await openDetail(page);
  const tabs = await page.getByRole("tab").allInnerTexts();
  fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(path.join(LOGS, "detail-tabs.json"), JSON.stringify({ tabs }, null, 2));
  console.log("MOUNTED TABS:", JSON.stringify(tabs));

  for (const label of EXPECTED_WORKBENCH_TABS) {
    await expect(page.getByRole("tab", { name: label, exact: true })).toBeVisible();
  }
});

test("detail: every mounted tab renders real data or an explicit empty state", async ({ page }) => {
  test.setTimeout(120_000);
  await openDetail(page);

  const tabs = await page.getByRole("tab").allInnerTexts();
  const report: Array<Record<string, unknown>> = [];

  for (const label of tabs) {
    const tab = page.getByRole("tab", { name: label, exact: true });
    await tab.click();
    const panel = page.locator('[role="tabpanel"]:visible').first();
    await expect(panel).toBeVisible();

    const heading = await panel.locator("h2, h3").first().innerText().catch(() => "");
    const text = await panel.innerText();
    const rows = await panel.locator("li, tr").count();

    // No placeholder styling, no skeleton shimmer, real copy only.
    expect(await panel.locator('[class*="animate-pulse"]').count(), `${label}: skeleton placeholder`).toBe(0);
    expect(text.trim().length, `${label}: panel copy`).toBeGreaterThan(30);
    expect(heading.trim().length, `${label}: panel heading`).toBeGreaterThan(0);

    report.push({ label, heading: heading.trim(), rows, chars: text.trim().length });
    if (["概览", "行程", "相册", "预算", "打包", "活动"].includes(label)) {
      await shot(page, `detail-${label}-1440.png`);
    }
  }

  fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(path.join(LOGS, "detail-tab-content.json"), JSON.stringify(report, null, 2));
  console.log("TAB CONTENT REPORT:", JSON.stringify(report));
  expect(report.length).toBeGreaterThanOrEqual(8);
});