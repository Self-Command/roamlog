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

interface SensitiveFormDocument {
  name: string;
  path: string;
  fields: Array<{ label: string; value: string }>;
}

function sensitiveFormDocuments(): SensitiveFormDocument[] {
  return [
    {
      name: "register",
      path: "/register",
      fields: [
        { label: "名字", value: "Prehydration User" },
        { label: "邮箱", value: "prehydration-register@roamlog.test" },
        { label: "密码", value: "Register-Should-Never-Leak-Aa1!" },
      ],
    },
    {
      name: "forgot-password",
      path: "/forgot-password",
      fields: [{ label: "邮箱", value: "prehydration-forgot@roamlog.test" }],
    },
    {
      name: "reset-password",
      path: "/reset-password?token=dummy-token",
      fields: [
        { label: "新密码", value: "Reset-Should-Never-Leak-Aa1!" },
        { label: "再次输入", value: "Reset-Should-Never-Leak-Aa1!" },
      ],
    },
    {
      name: "verify-email",
      path: "/verify-email",
      fields: [{ label: "邮箱", value: "prehydration-verify@roamlog.test" }],
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

for (const sensitive of sensitiveFormDocuments()) {
  test(`${sensitive.name} activates after hydration`, async ({ page }) => {
    await page.goto(`${WEB_URL}${sensitive.path}`, { waitUntil: "domcontentloaded" });

    await expect(
      page.locator("form").first().locator('button[type="submit"]'),
    ).toBeEnabled({ timeout: 30_000 });
  });

  test(`${sensitive.name} cannot submit sensitive fields before hydration`, async ({ page }) => {
    const url = `${WEB_URL}${sensitive.path}`;
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const form = page.locator("form").first();
    const submit = form.locator('button[type="submit"]');
    await expect(form).toHaveAttribute("method", "post");
    await expect(submit).toBeDisabled();

    for (const field of sensitive.fields) {
      await page.getByLabel(field.label, { exact: true }).fill(field.value);
    }
    await shot(page, `${sensitive.name}-prehydration-1440`);

    const lastField = page.getByLabel(sensitive.fields.at(-1)?.label ?? "", { exact: true });
    const navigated = page
      .waitForEvent("framenavigated", {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 1_500,
      })
      .then(() => true)
      .catch(() => false);
    await lastField.press("Enter");

    expect(await navigated).toBe(false);
    await expect(page).toHaveURL(url);
    for (const field of sensitive.fields) {
      expect(page.url()).not.toContain(field.value);
      expect(page.url()).not.toContain(encodeURIComponent(field.value));
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, `${sensitive.name}-prehydration-390`);
  });
}
