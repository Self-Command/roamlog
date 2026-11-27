/**
 * AI mobile shell acceptance.
 *
 * The page header in the app shell is intentionally not part of the chat
 * surface on a phone. The chat owns the viewport between the sticky app header
 * and MobileNav, otherwise a tall title/description pushes the composer under
 * the fixed bottom bar. These assertions are geometry-based on the real page:
 * every control must be fully inside the viewport and above MobileNav.
 *
 * Run: node node_modules/@playwright/test/cli.js test e2e/web/ai-mobile-layout.spec.ts --project=web
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { AI_WORKSPACE_SLUG } from "../ai-workflow-support";
import { OWNER_ACCOUNT, WEB_URL, findWorkspace, loginOnWeb } from "../support/accounts";

const OUT_DIR = path.resolve(process.cwd(), ".audit", "ai-port", "chat-mobile");

async function createSeededConversation(
  page: Page,
  workspaceId: string,
): Promise<{ conversationId: string; title: string }> {
  const title = `移动端验收 ${Date.now()}`;
  const created = await page.request.post(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations`,
    { data: { title } },
  );
  expect(created.status(), await created.text()).toBe(201);
  const conversation = (await created.json()) as { id: string };
  const message = await page.request.put(
    `${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversation.id}/messages/mobile-e2e-assistant`,
    {
      data: {
        role: "assistant",
        content: [{ type: "text", text: "移动端消息区保持可滚动，输入区始终在底部导航上方。" }],
      },
    },
  );
  expect(message.status(), await message.text()).toBe(200);
  return { conversationId: conversation.id, title };
}

async function assertControlsInsideViewport(page: Page, viewport: { width: number; height: number }) {
  const nav = page.getByRole("navigation", { name: "移动端主导航" });
  await expect(nav).toBeVisible();
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();

  const controls = [
    page.getByTestId("multimodal-input"),
    page.getByTestId("attachments-button"),
    page.getByTestId("model-selector"),
    page.getByTestId("reasoning-selector"),
    page.getByTestId("send-button"),
  ];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${await control.getAttribute("data-testid")} must have a box`).not.toBeNull();
    if (!box) continue;
    expect(box.x, "control must not be clipped on the left").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "control must not overflow horizontally").toBeLessThanOrEqual(
      viewport.width,
    );
    expect(box.y, "control must start below the app header").toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, "control must stay above MobileNav").toBeLessThanOrEqual(
      navBox!.y,
    );
  }

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
}

test.describe("AI mobile shell", () => {
  test("keeps every composer control above MobileNav at 390 and 360", async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT_DIR, { recursive: true });
    let conversationId: string | null = null;
    let workspaceId: string | null = null;

    try {
      await loginOnWeb(page, OWNER_ACCOUNT);
      const workspace = await findWorkspace(page.request, AI_WORKSPACE_SLUG);
      workspaceId = workspace.id;

      for (const viewport of [
        { width: 390, height: 844, name: "390" },
        { width: 360, height: 640, name: "360" },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${WEB_URL}/w/${workspace.slug}/ai`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: "从一个目标开始" })).toBeVisible({
          timeout: 30_000,
        });
        await assertControlsInsideViewport(page, viewport);
        await page.screenshot({
          path: path.join(OUT_DIR, `${viewport.name}-empty.png`),
          fullPage: false,
        });
      }

      const seeded = await createSeededConversation(page, workspace.id);
      conversationId = seeded.conversationId;

      for (const viewport of [
        { width: 390, height: 844, name: "390" },
        { width: 360, height: 640, name: "360" },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(
          `${WEB_URL}/w/${workspace.slug}/ai?conversation=${seeded.conversationId}`,
          { waitUntil: "domcontentloaded" },
        );
        await expect(page.getByTestId("multimodal-input")).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          page.getByText("移动端消息区保持可滚动，输入区始终在底部导航上方。"),
        ).toBeVisible();
        await assertControlsInsideViewport(page, viewport);
        await page.screenshot({
          path: path.join(OUT_DIR, `${viewport.name}-composer.png`),
          fullPage: false,
        });
      }
    } finally {
      if (conversationId && workspaceId) {
        await page.request
          .delete(`${WEB_URL}/v1/workspaces/${workspaceId}/ai/conversations/${conversationId}`)
          .catch(() => undefined);
      }
    }
  });
});
