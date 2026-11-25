import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  chooseReasoningEffort,
  cleanupConversation,
  driveToPlan,
  openAi,
  sendPrompt,
} from "../ai-workflow-support";

test.use({ trace: "off", video: "off" });

const OUT_DIR = path.resolve(
  process.cwd(),
  ".audit",
  "ai-workflow-port",
  "plan-draft",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

async function draftStorageText(page: Page): Promise<string> {
  return page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("roamlog.ai.human-drafts.v2:"))
      .map(([key, value]) => `${key}\n${value}`)
      .join("\n"),
  );
}

async function openEditableGroup(surface: Locator): Promise<Locator | null> {
  const groups = surface.getByTestId("plan-group");
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    const group = groups.nth(index);
    const bucket = await group.getAttribute("data-group-bucket");
    if (bucket === "trip" || bucket === "orphan") continue;
    const trigger = group.getByTestId("plan-group-trigger");
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    if ((await group.getByTestId("plan-row").count()) > 0) return group;
  }
  return null;
}

test("editable plan draft survives a real page refresh", async ({ page }) => {
  test.setTimeout(900_000);
  await openAi(page);
  try {
    await chooseReasoningEffort(page, "low");
    await sendPrompt(
      page,
      "2027 年 4 月 2 日到 6 日从上海去京都，两个人，总预算 8000 元含往返机票，住宿住商务酒店即可，节奏慢，喜欢古寺和咖啡。请先确认你的假设，再给出详细计划。",
    );
    await driveToPlan(page);

    const surface = page.getByTestId("plan-surface").last();
    await expect(surface).toBeVisible({ timeout: 300_000 });
    await surface.getByTestId("plan-draft-toggle").click();

    const message = surface.getByLabel("计划草稿正文");
    const originalMessage = await message.inputValue();
    expect(originalMessage.length).toBeGreaterThan(20);
    const draftMarker = `草稿验收-${String(Date.now())}`;
    await message.fill(`${originalMessage}\n\n${draftMarker}：改为更慢的古寺与咖啡节奏。`);
    await surface.getByLabel("计划草稿目标").fill("慢节奏古寺与咖啡，优先减少搬运行程");

    const selectedGroup = await openEditableGroup(surface);
    expect(selectedGroup, "a non-trip plan group should be editable").not.toBeNull();
    await selectedGroup!.getByTestId("plan-row").first().getByRole("checkbox").click();
    const selection = (
      await surface.getByTestId("plan-selection-summary").innerText()
    ).trim();
    expect(selection).toMatch(/^已选\s+\d+\s*\/\s*\d+$/u);

    await expect
      .poll(async () => draftStorageText(page), { timeout: 20_000 })
      .toContain(draftMarker);
    await shot(page, "01-before-refresh-1440");

    await page.reload({ waitUntil: "domcontentloaded" });
    const refreshed = page.getByTestId("plan-surface").last();
    await expect(refreshed).toBeVisible({ timeout: 120_000 });
    await refreshed.getByTestId("plan-draft-toggle").click();
    await expect(refreshed.getByLabel("计划草稿正文")).toHaveValue(
      new RegExp(draftMarker, "u"),
    );
    await expect(refreshed.getByLabel("计划草稿目标")).toHaveValue(
      "慢节奏古寺与咖啡，优先减少搬运行程",
    );
    await expect(refreshed.getByTestId("plan-selection-summary")).toHaveText(
      selection,
    );
    await expect(refreshed.getByTestId("plan-draft-dirty")).toHaveText("已修改");
    await shot(page, "02-after-refresh-1440");

    await page.setViewportSize({ width: 390, height: 844 });
    await refreshed.getByTestId("plan-draft-editor").scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(refreshed.getByLabel("计划草稿正文")).toBeVisible();
    await shot(page, "03-after-refresh-390");

    await refreshed.getByTestId("plan-draft-reset").click();
    await expect(refreshed.getByLabel("计划草稿正文")).toHaveValue(originalMessage);
    await expect(refreshed.getByTestId("plan-draft-dirty")).toHaveText("已修改");
    await shot(page, "04-restored-original-390");
  } finally {
    await cleanupConversation(page);
  }
});
