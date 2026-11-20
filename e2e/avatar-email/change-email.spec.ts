import { expect, test, type Page } from "@playwright/test";

import {
  ACCEPTANCE_API_URL,
  ACCEPTANCE_WEB_URL,
  readEmailLogs,
  readUserByEmail,
  signUpVerifiedAccount,
  verificationUrlFrom,
  waitForCapturedMail,
  type AcceptanceUser,
} from "./support";

/**
 * Defect 2: `POST /v1/auth/change-email` answered `400 CHANGE_EMAIL_DISABLED`
 * because Better Auth's `user.changeEmail.enabled` defaults to `false`.
 *
 * Mail is captured by Mailpit — a local SMTP sink, not a real inbox — which is
 * what makes the confirmation link observable here. The flow is then completed
 * for real: the current address gets the confirmation, the new address gets the
 * verification link, and only the second click moves the row.
 */

async function login(page: Page, user: AcceptanceUser): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/w\/[^/]+$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  if (!slug) {
    throw new Error(`no workspace slug in ${page.url()}`);
  }
  return slug;
}

test.describe("change email", () => {
  let user: AcceptanceUser;
  let newEmail: string;

  test.beforeAll(async () => {
    user = await signUpVerifiedAccount("email-e2e");
    newEmail = user.email.replace("@", "-new@");
  });

  test("enables the two-step change and moves the address after both links", async ({
    page,
    request,
  }) => {
    const slug = await login(page, user);
    await page.goto(`/w/${slug}/settings/security`);

    await expect(page.getByRole("heading", { name: "修改邮箱" })).toBeVisible();
    const emailForm = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "修改邮箱" }) });
    await emailForm.getByLabel("新邮箱").fill(newEmail);
    await emailForm.getByLabel("当前密码").fill(user.password);

    const changeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/auth/change-email") &&
        response.request().method() === "POST",
    );
    await emailForm.getByRole("button", { name: "修改邮箱", exact: true }).click();
    await expect(page.getByRole("button", { name: "发送确认邮件" })).toBeVisible();
    await page.getByRole("button", { name: "发送确认邮件" }).click();

    const response = await changeResponse;
    const body = (await response.json()) as { status?: boolean; code?: string; message?: string };

    // The regression: this used to be 400 CHANGE_EMAIL_DISABLED.
    expect(response.status(), JSON.stringify(body)).toBe(200);
    expect(body.code).not.toBe("CHANGE_EMAIL_DISABLED");
    expect(body.status).toBe(true);

    const notice = page.getByRole("status").filter({ hasText: "确认邮件已发送到" });
    await expect(notice).toBeVisible({ timeout: 25_000 });
    await expect(notice).toContainText(user.email);
    await expect(notice).toContainText(newEmail);

    await page.screenshot({
      path: ".audit/avatar-email/change-email-1440.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: ".audit/avatar-email/change-email-390.png",
      fullPage: true,
    });

    // Database evidence: the confirmation attempt is logged under its template.
    const logs = await readEmailLogs(user.email);
    const confirmation = logs.find((entry) => entry.template === "auth.change-email");
    expect(confirmation, "EmailLog must record the change-email confirmation").toBeTruthy();
    expect(["sent", "failed"]).toContain(confirmation?.status);

    // Better Auth sends the confirmation to the CURRENT address.
    const confirmationMail = await waitForCapturedMail(
      user.email,
      (mail) => mail.subject.includes("确认更换你的 Roamlog 邮箱"),
    );
    expect(confirmationMail.text).toContain(newEmail);
    const confirmUrl = verificationUrlFrom(confirmationMail);
    expect(confirmUrl, "confirmation mail must carry the verify link").toBeTruthy();

    // Clicking the confirmation link is what sends the verification mail to the
    // new address; the row still keeps its old address until that is verified.
    const confirmed = await request.get(confirmUrl as string, { maxRedirects: 0 });
    expect([200, 302, 303]).toContain(confirmed.status());
    expect((await readUserByEmail(user.email))?.email).toBe(user.email);

    const verificationMail = await waitForCapturedMail(
      newEmail,
      (mail) => mail.subject.includes("验证你的 Roamlog 邮箱"),
    );
    const verifyUrl = verificationUrlFrom(verificationMail);
    expect(verifyUrl, "verification mail must carry the verify link").toBeTruthy();
    const verified = await request.get(verifyUrl as string, { maxRedirects: 0 });
    expect([200, 302, 303]).toContain(verified.status());

    // The second click is what actually moves the address.
    await expect
      .poll(async () => (await readUserByEmail(newEmail))?.email ?? null, { timeout: 25_000 })
      .toBe(newEmail);
    expect(await readUserByEmail(user.email)).toBeNull();

    // The route keeps answering for the new identity instead of going back to
    // CHANGE_EMAIL_DISABLED.
    const probe = await request.post(`${ACCEPTANCE_API_URL}/v1/auth/change-email`, {
      data: { newEmail: newEmail.replace("-new@", "-next@") },
      headers: { "content-type": "application/json", origin: ACCEPTANCE_WEB_URL },
      maxRedirects: 0,
    });
    const probeBody = (await probe.json()) as { code?: string };
    expect(probeBody.code).not.toBe("CHANGE_EMAIL_DISABLED");
  });
});
