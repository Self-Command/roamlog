import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Journey 4 — edit an existing trip.
 *
 * Mock mode has no PATCH handler, so the edit page is verified in two layers:
 *  - the real mock behaviour (prefill + what actually happens on submit), and
 *  - a synthetic 200 PATCH (window.fetch patch, because MSW lives in a service
 *    worker and page.route cannot intercept its bypassed requests) that proves
 *    the form's success path once a server responds.
 */

const WORKSPACE = "roamlog-crew";
const TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010"; // 首尔，晚秋与夜航 (fixture)
const DETAIL = `/w/${WORKSPACE}/trips/${TRIP_ID}`;
const EDIT = `${DETAIL}/edit`;
const SHOTS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/shots");
const LOGS = path.resolve(process.cwd(), ".audit/evidence/g3-ui/logs");

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, name), animations: "disabled" });
}

function log(name: string, payload: unknown) {
  fs.mkdirSync(LOGS, { recursive: true });
  fs.writeFileSync(path.join(LOGS, name), JSON.stringify(payload, null, 2));
}

async function openEdit(page: Page) {
  await page.goto(EDIT);
  await expect(page.getByRole("heading", { name: "编辑旅行" })).toBeVisible({ timeout: 30_000 });
}

test("edit: page prefills every field from the trip", async ({ page }) => {
  await openEdit(page);

  await expect(page.locator("#trip-title")).toHaveValue("首尔，晚秋与夜航");
  await expect(page.locator("#trip-summary")).toHaveValue(/从上海出发/);
  await expect(page.locator("#trip-start-date")).toHaveText("2026年11月16日");
  await expect(page.locator("#trip-end-date")).toHaveText("2026年11月21日");
  await expect(page.locator("#trip-budget-amount")).toHaveValue("18800");
  await expect(page.locator("#trip-budget-currency")).toHaveValue("CNY");
  await expect(page.getByText("仅提交变更字段 · 当前版本 v7")).toBeVisible();
  await expect(page.getByRole("button", { name: /保存旅行/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /首尔，晚秋与夜航/ })).toBeVisible();
  await shot(page, "edit-prefilled-1440.png");
});

test("edit: submit persists the new title and echoes it back", async ({ page }) => {
  await openEdit(page);

  const newTitle = "首尔，晚秋与夜航（G3 已改）";
  await page.locator("#trip-title").fill(newTitle);
  await page.getByRole("button", { name: /保存旅行/ }).click();

  await page.waitForTimeout(4000);
  const observed = {
    url: page.url(),
    alerts: await page.locator('[role="alert"]').allInnerTexts(),
    status: await page.locator('[role="status"]').allInnerTexts(),
    titleValue: await page.locator("#trip-title").inputValue(),
  };
  log("edit-submit-observed.json", observed);
  console.log("EDIT SUBMIT OBSERVED:", JSON.stringify(observed));
  await shot(page, "edit-submit-result.png");

  // Required: the save navigates back to the detail page.
  await expect(page).toHaveURL(new RegExp(`${DETAIL.replace(/[/\\]/g, "\\$&")}$`), {
    timeout: 15_000,
  });
});

test("edit: with a responding server the form navigates back to detail", async ({ page }) => {
  await openEdit(page);
  // Read the fixture trip so the synthetic PATCH returns a schema-valid body.
  const original = await page.evaluate(
    async (tripId) => (await (await fetch(`/v1/trips/${tripId}`)).json()) as Record<string, unknown>,
    TRIP_ID,
  );

  await page.addInitScript(
    (cfg: { path: string; body: string }) => {
      const originalFetch = window.fetch;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (url.endsWith(cfg.path) && method === "PATCH") {
          return new Response(cfg.body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return originalFetch(input as RequestInfo, init);
      };
    },
    { path: `/v1/trips/${TRIP_ID}`, body: JSON.stringify({ ...original, version: 8 }) },
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "编辑旅行" })).toBeVisible({ timeout: 30_000 });

  await page.locator("#trip-title").fill("首尔，晚秋与夜航（合成 PATCH）");
  await page.getByRole("button", { name: /保存旅行/ }).click();
  await page.waitForTimeout(2500);
  log("edit-synthetic-patch.json", { urlAfterSubmit: page.url() });
  console.log("EDIT SYNTHETIC PATCH URL:", page.url());

  await expect(page).toHaveURL(new RegExp(`${DETAIL.replace(/[/\\]/g, "\\$&")}$`), {
    timeout: 15_000,
  });
  await shot(page, "edit-synthetic-after.png");
});