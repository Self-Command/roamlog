import { expect, test } from "../support/fixtures";
import { screenshot, WORKSPACE_PATH } from "../support/helpers";

test("journal filters entries, opens the detail sheet, and posts a comment", async ({ page }) => {
  await page.goto(`${WORKSPACE_PATH}/journal`);

  await expect(page.getByRole("heading", { name: "全部日志" })).toBeVisible();

  await page.getByLabel("搜索日志").fill("哲学");
  await expect(page.getByRole("button", { name: /在哲学之道走到天黑/ })).toBeVisible();

  await page.getByRole("button", { name: /在哲学之道走到天黑/ }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "在哲学之道走到天黑" })).toBeVisible();
  await expect(sheet.getByText("同行者的话")).toBeVisible();

  const comment = "E2E 评论：雨后的哲学之道很安静，想把这段路留得更久一点。";
  await sheet.getByLabel("评论内容").fill(comment);
  await sheet.getByRole("button", { name: "发送评论" }).click();

  await expect(sheet.getByText(comment)).toBeVisible();
  await screenshot(page, "web-1440-journal-sheet.png");
});
