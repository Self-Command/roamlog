import { expect, test } from "../support/fixtures";
import { screenshot, WORKSPACE_PATH } from "../support/helpers";

test("members invites, changes role, and revokes an invitation", async ({ page }) => {
  await page.goto(`${WORKSPACE_PATH}/members`);

  await expect(page.getByRole("heading", { name: "成员与邀请" })).toBeVisible();

  await page.getByRole("button", { name: "邀请成员" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("邮箱").fill("qa-invite@example.com");
  await dialog.getByLabel("角色").selectOption("admin");
  await dialog.getByLabel("附言").fill("Playwright 本地邀请验证。");
  await dialog.getByRole("button", { name: "发送邀请" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("qa-invite@example.com")).toBeVisible();

  const roleSelect = page.getByLabel("更改 Mira Chen 的角色");
  await roleSelect.selectOption("viewer");
  await expect(roleSelect).toHaveValue("viewer");

  const pending = page.getByRole("region", { name: "待接受邀请" });
  await expect(pending.getByText("daniel@atelier.co")).toBeVisible();
  await pending
    .getByText("daniel@atelier.co")
    .locator('xpath=ancestor::div[contains(@class, "flex-col")][1]')
    .getByRole("button", { name: "取消" })
    .click();

  await expect(pending.getByText("daniel@atelier.co")).toHaveCount(0);
  await screenshot(page, "web-1440-members.png");
});
