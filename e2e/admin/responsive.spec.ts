import { expect, test } from "../support/fixtures";
import { expectNoHorizontalOverflow, screenshot, setAdminRole } from "../support/helpers";

for (const width of [1440, 1024]) {
  test(`admin routes do not overflow at ${width}px`, async ({ page }) => {
    await setAdminRole(page, "super_admin");
    await page.setViewportSize({ width, height: 1000 });

    const routes = [
      { path: "/login", heading: "进入平台控制台", name: "login" },
      { path: "/admin", heading: "平台总览", name: "dashboard" },
      { path: "/admin/queues", heading: "队列", name: "queues" },
      { path: "/admin/flags", heading: "功能开关", name: "flags" },
      { path: "/admin/content", heading: "内容审核", name: "content" },
      { path: "/admin/users", heading: "用户", name: "users" },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page, `admin ${width}px ${route.name}`);
      await screenshot(page, `admin-${width}-${route.name}.png`);
    }
  });
}
