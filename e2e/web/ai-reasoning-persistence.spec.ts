/**
 * Real-stack check for the thinking-depth control:
 * - no "default" pseudo-option;
 * - the platform default is displayed as its real value;
 * - a user choice survives a browser refresh.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  WORKSPACE_SLUG,
  signInViaApi,
} from "../support/accounts";

const OUT_DIR = path.resolve(
  process.cwd(),
  ".audit",
  "ai-workflow-port",
  "reasoning-persistence-v2",
);

test.use({ trace: "off", video: "off" });
test.setTimeout(120_000);

test("reasoning effort follows the platform default and persists a user choice", async ({
  page,
}) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await signInViaApi(page.request, OWNER_ACCOUNT, "http://localhost:3000", API_URL);
  const resetAppearance = await page.request.put(`${WEB_URL}/v1/me/appearance`, {
    data: { mode: null, skin: null, fontPairing: null },
  });
  expect(resetAppearance.status(), await resetAppearance.text()).toBe(200);
  await page.route("**/v1/workspaces/*/ai/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        defaultModel: "stub/reasoning-model",
        reasoningSupported: true,
        models: [
          {
            id: "stub/reasoning-model",
            name: "Stub Reasoning",
            provider: "stub",
            reasoning: true,
            reasoningEfforts: ["low", "medium", "high"],
            vision: false,
          },
        ],
      }),
    });
  });
  await page.goto(`${WEB_URL}/w/${WORKSPACE_SLUG}/ai`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-font", "fluent-native");

  // Start from a clean browser preference while keeping the real session.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });

  const selector = page.getByTestId("reasoning-selector");
  const current = page.getByTestId("reasoning-selector-current");
  await expect(current).toHaveText("高");
  await page.screenshot({ path: path.join(OUT_DIR, "ai-reasoning-default-high-1440.png") });

  await selector.click();
  await expect(page.getByTestId("reasoning-option-default")).toHaveCount(0);
  await page.getByTestId("reasoning-option-medium").click();
  await expect(current).toHaveText("中");

  await page.screenshot({ path: path.join(OUT_DIR, "ai-reasoning-medium-1440.png") });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("multimodal-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("reasoning-selector-current")).toHaveText("中");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(OUT_DIR, "ai-reasoning-medium-390.png") });

  await page.evaluate(() => window.localStorage.clear());
});
