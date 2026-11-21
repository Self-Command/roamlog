/**
 * Journey 5 — the admin information architecture after the settings split.
 *
 * The sidebar owns navigation now:
 * - 服务配置 is a first-level group with five service destinations;
 * - 系统设置 stays a first-level entry under 数据与运营 and renders exactly four
 *   system groups, with no second-level settings navigation.
 *
 * The service pages reuse the same single-group form, but each is its own route
 * with one section and its own Chinese page title.
 */
import { expect, test, type Page } from "@playwright/test";

import {
  ADMIN_URL,
  API_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  enableSuperAdminTotp,
  loginOnAdmin,
  provisionSuperAdmin,
  WEB_URL,
} from "../../support/accounts";
import { registerFailureEvidence, uniqueRunId } from "../../support/smoke";

registerFailureEvidence(test);

const runId = uniqueRunId();
const superAdmin = createSuperAdminAccount(runId);
let superAdminTotpSecret = "";

const ADMIN_SETTINGS_PATH = "/admin/settings";
const ADMIN_SETTINGS_URL = `${ADMIN_URL}${ADMIN_SETTINGS_PATH}`;

const SYSTEM_SECTIONS = [
  { group: "general", label: "通用" },
  { group: "seo", label: "SEO" },
  { group: "theme", label: "主题" },
  { group: "limits", label: "限制" },
] as const;

const SERVICE_PAGES = [
  { href: "/admin/services/ai", label: "AI 服务", group: "ai" },
  { href: "/admin/services/storage", label: "存储服务", group: "storage" },
  { href: "/admin/services/places", label: "地图服务", group: "places" },
  { href: "/admin/services/mail", label: "发信服务", group: "mail" },
  { href: "/admin/services/media", label: "媒体处理", group: "media" },
] as const;

/**
 * Keep the real admin login form and Better Auth call, but send only the
 * sign-in POST to the API with an allowed origin. The local admin dev server
 * may run on a non-default port (the task harness uses 3201) while the API's
 * CORS allowlist still names the canonical web/admin origins; Better Auth
 * cookies are host-scoped, so the session still covers the admin server.
 */
async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.route("**/v1/auth/sign-in/email", async (route) => {
    const response = await route.fetch({
      url: `${API_URL}/v1/auth/sign-in/email`,
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_URL },
      postData: route.request().postData(),
    });
    await route.fulfill({ response });
  });

  await loginOnAdmin(page, superAdmin, superAdminTotpSecret);
  await expect(page.getByRole("navigation", { name: "管理后台主导航" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("admin settings information architecture", () => {
  test.beforeAll(async () => {
    provisionSuperAdmin(superAdmin);
    superAdminTotpSecret = await enableSuperAdminTotp(superAdmin);
  });

  test.afterAll(() => {
    deleteSuperAdmin(superAdmin.email);
  });

  test("unauthenticated deep link redirects to login with returnTo", async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(ADMIN_SETTINGS_URL);

    await expect
      .poll(
        () => {
          const url = new URL(page.url());
          return `${url.pathname}${url.search}`;
        },
        { timeout: 30_000 },
      )
      .toBe("/login?returnTo=%2Fadmin%2Fsettings");
    await expect(page.getByRole("heading", { name: "进入平台控制台" })).toBeVisible();
  });

  test("sidebar exposes 服务配置 and keeps 系统设置 as a sibling", async ({ page }) => {
    test.setTimeout(120_000);

    await loginAsSuperAdmin(page);

    const nav = page.getByRole("navigation", { name: "管理后台主导航" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(nav.getByRole("heading", { name: "服务配置", exact: true })).toBeVisible();

    const serviceSection = nav.locator('section[aria-labelledby="admin-nav-服务配置"]');
    await expect(serviceSection).toBeVisible();
    const serviceLinks = serviceSection.getByRole("link");
    await expect(serviceLinks).toHaveCount(SERVICE_PAGES.length);

    for (const service of SERVICE_PAGES) {
      await expect(
        serviceSection.getByRole("link", { name: service.label, exact: true }),
      ).toHaveAttribute("href", service.href);
    }

    const dataSection = nav.locator('section[aria-labelledby="admin-nav-数据与运营"]');
    const settingsLink = dataSection.getByRole("link", { name: "系统设置", exact: true });
    await expect(settingsLink).toHaveAttribute("href", ADMIN_SETTINGS_PATH);

    // A parent/child IA would put 系统设置 inside the 服务配置 section. Assert
    // both entries live directly under sibling, first-level sidebar sections and
    // share the same DOM depth from the navigation landmark.
    await expect(serviceSection.getByRole("link", { name: "系统设置", exact: true })).toHaveCount(
      0,
    );
    const [serviceLinkDepths, settingsLinkDepth] = await Promise.all([
      serviceLinks.evaluateAll((links) =>
        links.map((link) => {
          let depth = 0;
          let current: Element | null = link;
          while (current && current.tagName !== "NAV") {
            depth += 1;
            current = current.parentElement;
          }
          return depth;
        }),
      ),
      settingsLink.evaluate((link) => {
        let depth = 0;
        let current: Element | null = link;
        while (current && current.tagName !== "NAV") {
          depth += 1;
          current = current.parentElement;
        }
        return depth;
      }),
    ]);
    expect(new Set(serviceLinkDepths).size, "all service links share one level").toBe(1);
    expect(serviceLinkDepths[0], "服务配置 entries are first-level sidebar links").toBe(
      settingsLinkDepth,
    );
  });

  test("系统设置 renders exactly four sections with no nested navigation", async ({ page }) => {
    test.setTimeout(120_000);

    await loginAsSuperAdmin(page);

    const settingsLink = page
      .getByRole("navigation", { name: "管理后台主导航" })
      .getByRole("link", { name: "系统设置", exact: true });
    await expect(settingsLink).toBeVisible({ timeout: 30_000 });
    await settingsLink.click();

    await expect(page).toHaveURL(ADMIN_SETTINGS_URL);
    await expect(
      page.getByRole("heading", { level: 1, name: "系统设置", exact: true }),
    ).toBeVisible();

    const sections = page.locator("main section[data-settings-group]");
    await expect(sections).toHaveCount(SYSTEM_SECTIONS.length);
    expect(
      await sections.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-settings-group")),
      ),
    ).toEqual(SYSTEM_SECTIONS.map((section) => section.group));

    for (const section of SYSTEM_SECTIONS) {
      const rendered = page.locator(`main section[data-settings-group="${section.group}"]`);
      await expect(rendered).toHaveAttribute("aria-label", `${section.label} 设置`);
      await expect(
        rendered.getByRole("heading", { level: 2, name: section.label, exact: true }),
      ).toBeVisible();
    }

    await expect(page.getByRole("navigation", { name: "设置分组" })).toHaveCount(0);
    // The settings labels are localized end-to-end; the retired English label
    // must not survive in the general group.
    await expect(page.getByLabel("站点标题", { exact: true })).toBeVisible();
    await expect(page.getByText("Site title", { exact: true })).toHaveCount(0);
  });

  test("five service pages each render one section and no nested navigation", async ({ page }) => {
    test.setTimeout(180_000);

    await loginAsSuperAdmin(page);
    const nav = page.getByRole("navigation", { name: "管理后台主导航" });

    for (const service of SERVICE_PAGES) {
      const link = nav.getByRole("link", { name: service.label, exact: true });
      await expect(link).toBeVisible({ timeout: 30_000 });
      await link.click();

      await expect(page).toHaveURL(`${ADMIN_URL}${service.href}`);
      await expect(
        page.getByRole("heading", { level: 1, name: service.label, exact: true }),
      ).toBeVisible();

      const sections = page.locator("main section[data-settings-group]");
      await expect(sections).toHaveCount(1);
      await expect(sections).toHaveAttribute("data-settings-group", service.group);

      await expect(page.getByRole("navigation", { name: "设置分组" })).toHaveCount(0);
    }
  });
});
