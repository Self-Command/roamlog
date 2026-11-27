import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const WEB_URL = (process.env.E2E_WEB_URL ?? "http://localhost:3000").replace(/\/+$/u, "");
const ADMIN_URL = (process.env.E2E_ADMIN_URL ?? "http://localhost:3001").replace(/\/+$/u, "");

test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "auth-prehydration");

async function shot(page: Page, name: string) {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
}

function loginDocuments(): Array<{
  name: string;
  url: string;
  emailLabel: string;
  passwordLabel: string;
  emptySubmitText?: string;
}> {
  return [
    {
      name: "web",
      url: `${WEB_URL}/login`,
      emailLabel: "邮箱",
      passwordLabel: "密码",
      emptySubmitText: "请输入邮箱地址",
    },
    {
      name: "admin",
      url: `${ADMIN_URL}/login`,
      emailLabel: "管理员邮箱",
      passwordLabel: "密码",
    },
  ];
}

for (const surface of loginDocuments()) {
  test(`${surface.name} login activates after hydration`, async ({ page }) => {
    await page.goto(surface.url, { waitUntil: "domcontentloaded" });

    const submit = page.getByRole("button", { name: "登录", exact: true });
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();
    if (surface.emptySubmitText) {
      await expect(page.getByText(surface.emptySubmitText)).toBeVisible();
    } else {
      await expect(page).toHaveURL(surface.url);
    }
  });

  test(`${surface.name} login never submits credentials before hydration`, async ({ page }) => {
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto(surface.url, { waitUntil: "domcontentloaded" });

    const email = page.getByLabel(surface.emailLabel);
    const password = page.getByLabel(surface.passwordLabel);
    const submit = page.getByRole("button", { name: "登录", exact: true });

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(page.locator("form").first()).toHaveAttribute("method", "post");

    await email.fill("prehydration@roamlog.test");
    await password.fill("should-never-appear-in-the-url");
    await shot(page, `${surface.name}-prehydration-1440`);
    const navigated = page
      .waitForEvent("framenavigated", {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 1_500,
      })
      .then(() => true)
      .catch(() => false);
    await password.press("Enter");

    expect(await navigated).toBe(false);
    await expect(page).toHaveURL(surface.url);
    expect(page.url()).not.toContain("prehydration%40roamlog.test");
    expect(page.url()).not.toContain("should-never-appear-in-the-url");
  });
}

test("login pages fit a 390px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const surface of loginDocuments()) {
    await page.goto(surface.url, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, `${surface.name}-login-390`);
  }
});
