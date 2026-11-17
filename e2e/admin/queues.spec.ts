import { expect, test } from "../support/fixtures";
import { screenshot, setAdminRole } from "../support/helpers";

test("queue retry requires the exact job identifier confirmation", async ({ page }) => {
  await setAdminRole(page, "admin");
  await page.goto("/admin/queues");

  await expect(page.getByRole("heading", { name: "队列", exact: true })).toBeVisible();

  const retryButton = page.getByRole("button", { name: "重试任务" }).first();
  await expect(retryButton).toBeEnabled();
  await retryButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "重试任务" })).toBeVisible();
  const confirmButton = dialog.getByRole("button", { name: "确认重试" });
  await expect(confirmButton).toBeDisabled();

  await dialog.getByLabel("输入任务 ID 确认").fill("job-export-7781");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(page.getByText("已重新入队：job-export-7781")).toBeVisible();
  await expect(page.getByRole("row", { name: "失败任务 job-export-7781" })).toHaveCount(0);
  await screenshot(page, "admin-1440-queues.png");
});
