/**
 * Real-browser acceptance for AI conversation visibility and public sharing.
 *
 * Run:
 *   pnpm exec playwright test e2e/web/ai-visibility-share.spec.ts --project=web
 */

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { OWNER_ACCOUNT, WEB_URL, loginOnWeb } from "../support/accounts";

test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-port", "visibility");

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

async function firstWorkspace(page: Page): Promise<{ id: string; slug: string }> {
  const response = await page.request.get(`${WEB_URL}/v1/me/workspaces`);
  expect(response.status()).toBe(200);
  const rows = (await response.json()) as Array<{ id: string; slug: string }>;
  expect(rows[0]).toBeTruthy();
  return rows[0]!;
}

/** Seeds one assistant message through the real idempotent message endpoint. */
async function createConversationWithMessages(
  page: Page,
  workspaceId: string,
): Promise<{ conversationId: string; title: string }> {
  const title = `公开分享验收 ${Date.now()}`;
  const created = await page.request.post(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations`,
    { data: { title } },
  );
  expect(created.status()).toBe(201);
  const conversation = (await created.json()) as { id: string };

  const message = await page.request.put(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversation.id}/messages/e2e-share-assistant`,
    {
      data: {
        content: [
          {
            type: "text",
            text: "第一天去清水寺，第二天去岚山，第三天沿鸭川散步。",
          },
          {
            type: "tool-call",
            toolName: "internal-only-tool",
            args: { workspaceId, private: true },
          },
        ],
      },
    },
  );
  expect(message.status()).toBe(200);
  return { conversationId: conversation.id, title };
}

test.describe("AI visibility and public share", () => {
  test("header toggle, clipboard URL, anonymous read and revocation", async ({ page, browser }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT_DIR, { recursive: true });
    let conversationId: string | null = null;
    let workspaceId: string | null = null;

    try {
      await loginOnWeb(page, OWNER_ACCOUNT);
      const workspace = await firstWorkspace(page);
      workspaceId = workspace.id;
      const created = await createConversationWithMessages(page, workspace.id);
      conversationId = created.conversationId;

      await page.goto(`${WEB_URL}/w/${workspace.slug}/ai?conversation=${created.conversationId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText(created.title, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      const visibilityTrigger = page.locator('[data-testid="visibility-selector"]:visible');
      await expect(visibilityTrigger).toBeVisible();

      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: WEB_URL,
      });
      await visibilityTrigger.click();
      await page.getByTestId("visibility-selector-item-public").click();
      await expect(page.getByTestId("visibility-copy-link")).toContainText("复制公开链接", {
        timeout: 20_000,
      });
      await shot(page, "owner-public-1440");

      const publicConversation = (await (
        await page.request.get(
          `${WEB_URL}/v1/workspaces/${workspace.id}/ai/conversations/${created.conversationId}`,
        )
      ).json()) as { visibility: string; shareUrl: string | null };
      expect(publicConversation.visibility).toBe("public");
      expect(publicConversation.shareUrl).toContain("/share/chat/");
      const shareUrl = publicConversation.shareUrl!;

      await page.getByTestId("visibility-copy-link").click();
      await expect(page.getByTestId("visibility-copy-link")).toContainText("链接已复制");
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toBe(shareUrl);

      const token = new URL(shareUrl).pathname.split("/").filter(Boolean).at(-1);
      expect(token).toBeTruthy();
      const guest = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const guestPage = await guest.newPage();
      await guestPage.goto(shareUrl, { waitUntil: "domcontentloaded" });
      await expect(
        guestPage.getByRole("heading", { name: created.title, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        guestPage.getByText("第一天去清水寺，第二天去岚山，第三天沿鸭川散步。"),
      ).toBeVisible();
      await expect(guestPage.getByLabel("给 AI 助手发消息")).toHaveCount(0);
      await expect(guestPage.getByTestId("artifact")).toHaveCount(0);
      await shot(guestPage, "public-chat-1440");

      const publicApi = await guest.request.get(
        `${WEB_URL}/v1/public/ai-chats/${encodeURIComponent(token!)}`,
      );
      expect(publicApi.status()).toBe(200);
      const publicBody = (await publicApi.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(publicBody);
      expect(serialized).not.toContain(workspace.id);
      expect(serialized).not.toContain(created.conversationId);
      expect(serialized).not.toContain("internal-only-tool");

      await guestPage.setViewportSize({ width: 390, height: 844 });
      await guestPage.waitForTimeout(300);
      await shot(guestPage, "public-chat-390");
      await guest.close();

      // The copy action uses `preventDefault` so the menu stays open; selecting
      // private immediately lets the test observe the revoked URL in place.
      await page.getByTestId("visibility-selector-item-private").click();
      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${WEB_URL}/v1/workspaces/${workspace.id}/ai/conversations/${created.conversationId}`,
          );
          return ((await response.json()) as { shareUrl: string | null }).shareUrl;
        })
        .toBeNull();

      const revoked = await page.request.get(
        `${WEB_URL}/v1/public/ai-chats/${encodeURIComponent(token!)}`,
      );
      expect(revoked.status()).toBe(404);
      const deniedContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const deniedPage = await deniedContext.newPage();
      const deniedResponse = await deniedPage.goto(shareUrl, {
        waitUntil: "domcontentloaded",
      });
      expect(deniedResponse?.status()).toBe(404);
      await shot(deniedPage, "revoked-404-1440");
      await deniedContext.close();
      await shot(page, "owner-private-1440");

      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-testid="visibility-selector"]:visible').click();
      await expect(page.getByTestId("visibility-selector-item-private")).toContainText("私密");
      await shot(page, "owner-private-390");
    } finally {
      if (conversationId && workspaceId) {
        await page.request
          .delete(`${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}`)
          .catch(() => undefined);
      }
    }
  });

  test("sidebar Share submenu toggles public through the same API", async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(OUT_DIR, { recursive: true });
    let conversationId: string | null = null;
    let workspaceId: string | null = null;
    try {
      await loginOnWeb(page, OWNER_ACCOUNT);
      const workspace = await firstWorkspace(page);
      workspaceId = workspace.id;
      const created = await createConversationWithMessages(page, workspace.id);
      conversationId = created.conversationId;

      await page.goto(`${WEB_URL}/w/${workspace.slug}/ai?conversation=${created.conversationId}`, {
        waitUntil: "domcontentloaded",
      });
      const row = page.getByTestId("thread-list-item").filter({ hasText: created.title });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.hover();
      await page.getByRole("button", { name: `会话操作：${created.title}` }).click();
      await page.getByRole("menuitem", { name: "分享" }).click();
      await page.getByTestId("visibility-selector-item-public").click();

      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${WEB_URL}/v1/workspaces/${workspace.id}/ai/conversations/${created.conversationId}`,
          );
          return ((await response.json()) as { visibility: string }).visibility;
        })
        .toBe("public");
      await shot(page, "sidebar-public-1440");
    } finally {
      if (conversationId && workspaceId) {
        await page.request
          .delete(`${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}`)
          .catch(() => undefined);
      }
    }
  });
});
