import { expect, test } from "../support/fixtures";
import { screenshot, setAdminRole } from "../support/helpers";

test("content moderation soft deletes and restores with confirmation", async ({ page }) => {
  await setAdminRole(page, "admin");
  await page.goto("/admin/content");

  await expect(page.getByRole("heading", { name: "内容审核" })).toBeVisible();

  const title = "冬季瀨戶內海跳岛";
  const row = page.getByRole("row", { name: `内容 ${title}` });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "删除内容" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "删除内容" })).toBeVisible();
  await dialog.getByLabel("输入内容标题确认").fill(title);
  await dialog.getByRole("button", { name: "确认删除" }).click();

  await expect(row.getByText("已删除")).toBeVisible();

  await row.getByRole("button", { name: "恢复内容" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "恢复内容" })).toBeVisible();
  await dialog.getByLabel("输入内容标题确认").fill(title);
  await dialog.getByRole("button", { name: "确认恢复" }).click();

  await expect(row.getByText("已发布")).toBeVisible();
  await screenshot(page, "admin-1440-content.png");
});
