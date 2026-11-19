/**
 * Journey 2 — place search in the new-trip origin field.
 *
 * Assertions:
 * - typing 「京都」 produces at least one suggestion;
 * - the dropdown footer credits the provider returned by
 *   `GET /v1/places/search` (Geoapify or Photon/OSM — never hard-coded);
 * - when the provider degrades to an empty result (no Geoapify key), the
 *   manual-entry fallback is offered and the journey still passes.
 *
 * The journey never selects a suggestion and never submits the form, so it
 * creates no trips.
 */
import { expect, test } from "@playwright/test";

import {
  auxiliaryApiSession,
  loginOnWeb,
  OWNER_ACCOUNT,
  routeBrowserApi,
  WORKSPACE_SLUG,
} from "../../support/accounts";
import { registerFailureEvidence } from "../../support/smoke";

registerFailureEvidence(test);

interface PlaceSearchBody {
  items: Array<{ name?: string; provider?: string }>;
  provider?: "geoapify" | "photon" | null;
  degraded?: boolean;
}

test.describe("places search and attribution", () => {
  test("京都 suggestions carry the provider credit or offer manual entry", async ({ page }) => {
    test.setTimeout(90_000);

    await loginOnWeb(page, OWNER_ACCOUNT);

    // Optional: route client API calls to a stable auxiliary API process when
    // the shared :4000 process is being restarted by another agent.
    const auxiliaryApi = process.env.E2E_SMOKE_API_URL?.trim();
    if (auxiliaryApi) {
      const cookie = await auxiliaryApiSession(auxiliaryApi, OWNER_ACCOUNT);
      await routeBrowserApi(page, auxiliaryApi, cookie);
    }

    await page.goto(`/w/${WORKSPACE_SLUG}/trips/new`);
    await expect(page.getByRole("heading", { name: "新建旅行" })).toBeVisible();

    const origin = page.getByRole("combobox", { name: "旅行起点" });
    await expect(origin).toBeVisible();

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/places/search") &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );

    await origin.fill("京都");
    const response = await responsePromise;
    expect(response.status(), `places search returned HTTP ${response.status()}`).toBe(200);
    const payload = (await response.json()) as PlaceSearchBody;

    const listbox = page.getByRole("listbox", { name: "旅行起点建议" });
    const options = listbox.getByRole("option");
    const manualOption = listbox.getByRole("option", { name: `使用「京都」作为起点` });
    const degradedNote = listbox
      .locator('[role="status"]')
      .filter({ hasText: "搜索服务暂时降级" });

    if (payload.degraded === true && payload.items.length === 0) {
      // No Geoapify key configured: the product must not dead-end the form.
      await expect(degradedNote).toBeVisible({ timeout: 30_000 });
      await expect(manualOption).toBeVisible();
      test.info().annotations.push({
        type: "places-provider",
        description: "degraded provider with zero results; manual fallback verified",
      });
      return;
    }

    expect(payload.items.length, "configured provider must return at least one suggestion").toBeGreaterThan(0);
    await expect(options.first()).toBeVisible({ timeout: 30_000 });
    expect(await options.count()).toBeGreaterThanOrEqual(1);
    await expect(options.first()).toContainText("京都");

    // A degraded response can still carry fallback results; the UI must say so
    // while keeping manual entry available.
    if (payload.degraded === true) {
      await expect(degradedNote).toBeVisible();
      await expect(manualOption).toBeVisible();
    } else {
      await expect(degradedNote).toHaveCount(0);
    }

    const attribution = page.locator('[data-testid="places-attribution"]');
    await expect(attribution).toBeVisible();
    const provider = await attribution.getAttribute("data-provider");
    expect(provider, "attribution must name the provider of the visible results").toBe(
      payload.provider ?? "unknown",
    );

    const credit = (await attribution.innerText()).trim();
    expect(credit).toMatch(/Powered by Geoapify|© OpenStreetMap contributors/u);
    if (provider === "geoapify") {
      expect(credit).toContain("Powered by Geoapify");
    } else if (provider === "photon") {
      expect(credit).toContain("Search by Photon");
      expect(credit).toContain("© OpenStreetMap contributors");
    }

    test.info().annotations.push({
      type: "places-provider",
      description: `provider=${provider}; suggestions=${payload.items.length}; credit="${credit}"`,
    });
  });
});