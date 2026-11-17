import { expect, test } from "../support/fixtures";
import { screenshot, setAdminRole, setRangeValue } from "../support/helpers";

test("feature flag rollout changes are saved with super admin", async ({ page }) => {
  await setAdminRole(page, "super_admin");
  await page.goto("/admin/flags");

  await expect(page.getByRole("heading", { name: "功能开关" })).toBeVisible();

  const flag = page.getByRole("article", { name: "功能开关 share-password-v1" });
  await setRangeValue(page, "share-password-v1 灰度比例", 60);

  const saveButton = flag.getByRole("button", { name: "保存配置" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  await expect(page.getByText("已保存 share-password-v1：开启 / 60%")).toBeVisible();
  await screenshot(page, "admin-1440-flags.png");
});
