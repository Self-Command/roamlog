import { test } from "@playwright/test";

import {
  ADMIN_ROUTES,
  assertVisualRules,
  captureVisualScreenshot,
  gotoAndWait,
  setAdminRole,
  VISUAL_HEIGHTS,
  VISUAL_WIDTHS,
} from "../../a11y/support";

for (const route of ADMIN_ROUTES) {
  test(`admin visual ${route.name} at 1440, 1024, and 390`, async ({ page }) => {
    await setAdminRole(page);
    for (const width of VISUAL_WIDTHS) {
      await page.setViewportSize({ width, height: VISUAL_HEIGHTS[width] });
      await gotoAndWait(page, route);
      await captureVisualScreenshot(page, "admin", route.name, width);
      await assertVisualRules(page, `admin ${route.name} ${width}px`);
    }
  });
}
