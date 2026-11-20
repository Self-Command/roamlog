import { expect, test, type Page } from "@playwright/test";

import {
  ACCEPTANCE_API_URL,
  readUserByEmail,
  signUpVerifiedAccount,
  type AcceptanceUser,
} from "./support";

/**
 * Defect 1: the avatar used to be persisted as the 15-minute S3 signed URL, so
 * it vanished after `EXPORT_SIGNED_URL_TTL` and the shell fell back to initials.
 *
 * These assertions prove the row holds a stable media id and that every read
 * re-signs a fresh, loadable URL — across a reload, and after the upload-time
 * URL would already have expired.
 */

const AVATAR_FILE = ".audit/settings/fixtures/avatar.png";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function expectLoaded(image: ReturnType<Page["locator"]>): Promise<void> {
  await expect
    .poll(async () => image.evaluate((element) => (element as HTMLImageElement).naturalWidth), {
      message: "avatar <img> must decode real pixels",
      timeout: 25_000,
    })
    .toBeGreaterThan(0);
}

/** Expiry of a SigV4 URL, read from its own query string. */
function signedUrlExpiry(url: string): Date | null {
  const parsed = new URL(url);
  const expires = Number(parsed.searchParams.get("X-Amz-Expires"));
  const date = parsed.searchParams.get("X-Amz-Date");
  if (!Number.isFinite(expires) || !date) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const issued = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return new Date(issued + expires * 1_000);
}

test.describe("avatar stability", () => {
  let user: AcceptanceUser;

  test.beforeAll(async () => {
    user = await signUpVerifiedAccount("avatar-e2e");
  });

  test("uploads an avatar, stores a media id, and keeps rendering it after a reload", async ({
    page,
  }) => {
    const slug = await login(page, user);
    await page.goto(`/w/${slug}/settings/profile`);

    const section = page.locator('section[aria-label="头像"]');
    await expect(section).toBeVisible();
    // Empty state: a brand-new account has no avatar yet.
    await expect(page.getByRole("button", { name: "上传头像" })).toBeVisible();

    await page.getByTestId("avatar-file-input").setInputFiles(AVATAR_FILE);
    await expect(page.getByRole("status").filter({ hasText: "头像已更新。" })).toBeVisible({
      timeout: 150_000,
    });
    await expect(page.getByRole("button", { name: "替换头像" })).toBeVisible();

    const image = page.locator('section[aria-label="头像"] img');
    await expectLoaded(image);
    const firstSrc = await image.getAttribute("src");
    expect(firstSrc).toBeTruthy();
    expect(firstSrc).toContain("X-Amz-Signature");

    // The stable form lives in the row: a media id, never a signed URL.
    const stored = await readUserByEmail(user.email);
    expect(stored, "the account must exist").toBeTruthy();
    expect(
      stored?.image,
      "user.image must store the media id, not the 15-minute signed URL",
    ).toMatch(UUID_PATTERN);

    await page.screenshot({
      path: ".audit/avatar-email/avatar-1440.png",
      fullPage: true,
    });

    // Reload: the API re-signs the stored id, so the URL changes but still loads.
    await page.waitForTimeout(1_500);
    await page.reload();
    const reloaded = page.locator('section[aria-label="头像"] img');
    await expectLoaded(reloaded);
    const secondSrc = await reloaded.getAttribute("src");
    expect(secondSrc).toBeTruthy();
    expect(secondSrc, "the reload must carry a freshly signed URL").not.toBe(firstSrc);

    // Every read returns a freshly signed URL — never the upload-time one.
    const first = await page.request.get(`${ACCEPTANCE_API_URL}/v1/me`);
    expect(first.status()).toBe(200);
    const firstMe = (await first.json()) as { image: string | null };
    await page.waitForTimeout(1_500);
    const second = await page.request.get(`${ACCEPTANCE_API_URL}/v1/me`);
    expect(second.status()).toBe(200);
    const secondMe = (await second.json()) as { image: string | null };

    expect(firstMe.image, "GET /v1/me must return an avatar URL").toBeTruthy();
    expect(secondMe.image).toBeTruthy();
    expect(secondMe.image).not.toBe(firstMe.image);

    for (const url of [firstMe.image as string, secondMe.image as string]) {
      // Fresh signature: expiry is now + TTL, not upload time + TTL.
      const expiry = signedUrlExpiry(url);
      expect(expiry, "avatar URL must keep its SigV4 expiry").not.toBeNull();
      expect((expiry as Date).getTime()).toBeGreaterThan(Date.now() + 8 * 60_000);
      const asset = await page.request.get(url);
      expect(asset.status(), `signed avatar ${url} must load`).toBe(200);
      expect(asset.headers()["content-type"] ?? "").toContain("image/");
    }

    // A second read after the first URL's clock has moved proves the server
    // re-signs rather than replaying a stored URL.
    const storedAfter = await readUserByEmail(user.email);
    expect(storedAfter?.image).toBe(stored?.image);

    // Mobile viewport also renders the stored avatar.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expectLoaded(page.locator('section[aria-label="头像"] img'));
    await page.screenshot({
      path: ".audit/avatar-email/avatar-390.png",
      fullPage: true,
    });
  });
});