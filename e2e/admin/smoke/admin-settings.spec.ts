/**
 * Journey 5 — `/admin/settings` is a real console, and its consumption labels
 * tell the truth about each group.
 *
 * The status of every group is read from `data-consumption-status` + rendered
 * copy at runtime instead of being hard-coded in the test, so a future wiring
 * change (unwired → backend) updates the assertion target automatically while
 * the honesty rules stay fixed:
 * - the footer of every group states a consumption status;
 * - `unwired` groups must say 未接入/不生效 and must not claim backend wiring;
 * - `backend`/`frontend` groups must state what consumes them;
 * - the retired sentence 「已接入后端，前端/Worker 消费待完成」 never appears;
 * - the media group carries a per-key consumption badge for every key.
 */
import { expect, test } from "@playwright/test";

import {
  ADMIN_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  loginOnAdmin,
  provisionSuperAdmin,
} from "../../support/accounts";
import { registerFailureEvidence, uniqueRunId } from "../../support/smoke";

registerFailureEvidence(test);

const runId = uniqueRunId();
const superAdmin = createSuperAdminAccount(runId);

const GROUPS = [
  { key: "general", label: "General" },
  { key: "seo", label: "SEO" },
  { key: "theme", label: "Theme" },
  { key: "mail", label: "Mail" },
  { key: "storage", label: "Storage" },
  { key: "media", label: "Media" },
  { key: "ai", label: "AI" },
  { key: "places", label: "Places" },
  { key: "limits", label: "Limits" },
] as const;

const FORBIDDEN_COPY = "已接入后端，前端/Worker 消费待完成";

test.describe("admin settings console", () => {
  test.beforeAll(() => {
    provisionSuperAdmin(superAdmin);
  });

  test.afterAll(() => {
    deleteSuperAdmin(superAdmin.email);
  });

  test("nine groups, per-key media badges and honest consumption status", async ({ page }) => {
    test.setTimeout(120_000);

    const signedIn = await loginOnAdmin(page, superAdmin);
    test.skip(
      !signedIn,
      "ADMIN_2FA_ENFORCED: the provisioned super_admin has no TOTP secret; enable a seeded TOTP account to run this journey.",
    );

    await page.goto(`${ADMIN_URL}/admin/settings`);
    const nav = page.getByRole("navigation", { name: "设置分组" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(nav.getByRole("link")).toHaveCount(GROUPS.length);
    for (const group of GROUPS) {
      await expect(
        nav.getByRole("link", { name: new RegExp(`^${group.label}`, "u") }),
      ).toBeVisible();
    }

    const observations: Record<string, { status: string; copy: string }> = {};

    for (const group of GROUPS) {
      await page.goto(`${ADMIN_URL}/admin/settings?group=${group.key}`);
      const section = page.locator(`section[aria-label="${group.label} 设置"]`);
      await expect(section).toBeVisible({ timeout: 30_000 });

      const status = section.locator("footer[aria-label=\"分组消费状态\"] [data-consumption-status]");
      await expect(status, `${group.key} must declare a consumption status`).toBeVisible();
      const statusValue = await status.getAttribute("data-consumption-status");
      const copy = (await status.innerText()).trim();
      expect(["frontend", "backend", "unwired"]).toContain(statusValue);
      observations[group.key] = { status: statusValue as string, copy };

      if (statusValue === "unwired") {
        expect(copy, `${group.key} is unwired and must say so`).toMatch(/未接入|不生效/u);
      } else if (statusValue === "backend") {
        expect(copy, `${group.key} is backend-consumed`).toMatch(/后端已消费/u);
      } else {
        expect(copy, `${group.key} is frontend-consumed`).toMatch(/前端已消费/u);
      }
    }

    // Media is the only group with mixed keys: every key gets its own badge,
    // and the two unwired switches may not hide behind a green group badge.
    await page.goto(`${ADMIN_URL}/admin/settings?group=media`);
    const mediaSection = page.locator('section[aria-label="Media 设置"]');
    await expect(mediaSection).toBeVisible({ timeout: 30_000 });
    const mediaBadges = mediaSection.locator('[aria-label$=" 消费状态"]');
    await expect(mediaBadges, "one per-key consumption badge per media setting").toHaveCount(6);
    const mediaCopy = await mediaBadges.allInnerTexts();
    for (const text of mediaCopy) {
      expect(text).toMatch(/前端已消费|未接入（不生效）/u);
    }
    expect(
      mediaCopy.some((text) => text.includes("未接入（不生效）")),
      "media.keepOriginal / media.livePhotoEnabled must be labelled unwired",
    ).toBe(true);
    expect(
      mediaCopy.some((text) => text.includes("前端已消费")),
      "consumed media keys must stay labelled as consumed",
    ).toBe(true);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FORBIDDEN_COPY);

    await test.info().attach("settings-consumption.json", {
      body: Buffer.from(JSON.stringify(observations, null, 2)),
      contentType: "application/json",
    });

    test.info().annotations.push({
      type: "settings-consumption",
      description: Object.entries(observations)
        .map(([group, value]) => `${group}=${value.status}`)
        .join(", "),
    });
  });
});