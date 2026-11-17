import { expect, test } from "../support/fixtures";
import { screenshot, setAdminRole } from "../support/helpers";

test("analyst sees content moderation controls disabled", async ({ page }) => {
  await setAdminRole(page, "analyst");
  await page.goto("/admin/content");

  await expect(page.getByRole("heading", { name: "内容审核" })).toBeVisible();
  await expect(
    page.getByText("Analyst 仅可查看内容与审计信号；软删除和恢复保持可见但禁用。"),
  ).toBeVisible();

  const firstRow = page.getByRole("row", { name: /^内容 / }).first();
  await expect(firstRow.getByRole("button", { name: "删除内容" })).toBeDisabled();
  await screenshot(page, "admin-1440-analyst-content.png");
});

test("support can suspend users but cannot delete users or change roles", async ({ page }) => {
  await setAdminRole(page, "support");
  await page.goto("/admin/users");

  await expect(page.getByRole("heading", { name: "用户", exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: "用户 林知夏" });
  await expect(row.getByRole("button", { name: "暂停账户" })).toBeEnabled();
  await expect(row.getByRole("button", { name: "删除用户" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "修改平台角色" })).toBeDisabled();
  await screenshot(page, "admin-1440-support-users.png");
});
