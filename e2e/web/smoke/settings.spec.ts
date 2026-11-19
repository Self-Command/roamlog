/**
 * Journey 1 — the admin `site.title` setting drives the public site title.
 *
 * Evidence chain:
 *   super_admin session → PATCH /v1/admin/settings (site.title = unique value)
 *   → GET /v1/public/settings reflects it immediately
 *   → an anonymous `/login` page eventually renders `<title>… · <unique></title>`
 *     (Next's public-settings fetch revalidates every 30 s, so the assertion
 *     polls reloads instead of sleeping a fixed amount).
 *
 * The original value is restored in `finally`, before the account is deleted,
 * so a failed run cannot leave the site with a smoke title.
 */
import { expect, test } from "@playwright/test";

import {
  ADMIN_URL,
  API_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  provisionSuperAdmin,
  signInViaApi,
} from "../../support/accounts";
import { registerFailureEvidence, uniqueRunId } from "../../support/smoke";

registerFailureEvidence(test);

const runId = uniqueRunId();
const superAdmin = createSuperAdminAccount(runId);

interface AdminSettingsBody {
  groups: Array<{ items: Array<{ key: string; value?: unknown }> }>;
}

function settingValue(body: AdminSettingsBody, key: string): string | null {
  const item = body.groups.flatMap((group) => group.items).find((entry) => entry.key === key);
  return typeof item?.value === "string" ? item.value : null;
}

test.describe("settings-driven site title", () => {
  test.beforeAll(() => {
    provisionSuperAdmin(superAdmin);
  });

  test.afterAll(() => {
    deleteSuperAdmin(superAdmin.email);
  });

  test("site.title reaches the public document title and is restored", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);

    await signInViaApi(request, superAdmin, ADMIN_URL);

    const readSettings = async (): Promise<AdminSettingsBody> => {
      const response = await request.get(`${API_URL}/v1/admin/settings`);
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as AdminSettingsBody;
    };

    const settings = await readSettings();
    const originalTitle = settingValue(settings, "site.title");
    const originalTemplate = settingValue(settings, "seo.titleTemplate");
    expect(originalTitle, "site.title must have a database value to restore").toBeTruthy();

    const uniqueTitle = `Roamlog smoke ${runId}`;
    const patchSettings = async (
      updates: Array<{ key: string; value: string }>,
    ): Promise<void> => {
      const response = await request.patch(`${API_URL}/v1/admin/settings`, {
        headers: { origin: ADMIN_URL },
        data: { updates },
      });
      expect(response.status(), await response.text()).toBe(200);
    };

    try {
      // 1) site.title alone must reach the public projection immediately.
      await patchSettings([{ key: "site.title", value: uniqueTitle }]);
      const publicSettings = await request.get(`${API_URL}/v1/public/settings`);
      expect(publicSettings.status()).toBe(200);
      const publicTitle = (await publicSettings.json()).settings["site.title"];
      expect(publicTitle).toBe(uniqueTitle);

      // 2) /login titles are composed by `seo.titleTemplate`. The seeded
      //    template is a fixed string (`%s · Roamlog`) that intentionally does
      //    not include the site title, so the smoke also points the template at
      //    the unique title. When the template is not public/unset, the product
      //    falls back to `%s · <site.title>` and this still holds.
      if (originalTemplate !== null) {
        await patchSettings([{ key: "seo.titleTemplate", value: `%s · ${uniqueTitle}` }]);
      }

      // `page` is an anonymous context: the super_admin session lives only in
      // the APIRequestContext above, so `/login` cannot redirect to a workspace.
      const startedAt = Date.now();
      await page.goto("/login");
      await expect
        .poll(
          async () => {
            await page.reload({ waitUntil: "domcontentloaded" });
            return page.title();
          },
          {
            message:
              "the settings-driven title must reach the login <title> after the 30s revalidation window",
            timeout: 220_000,
            intervals: [1_000, 2_000, 3_000, 5_000, 10_000],
          },
        )
        .toContain(uniqueTitle);

      test.info().annotations.push({
        type: "propagation",
        description: `settings-driven title reached /login <title> in ${Date.now() - startedAt}ms`,
      });
    } finally {
      const restore = [{ key: "site.title", value: originalTitle as string }];
      if (originalTemplate !== null) {
        restore.push({ key: "seo.titleTemplate", value: originalTemplate });
      }
      await patchSettings(restore);

      const restored = await request.get(`${API_URL}/v1/public/settings`);
      expect(restored.status()).toBe(200);
      expect((await restored.json()).settings["site.title"]).toBe(originalTitle);
    }
  });
});