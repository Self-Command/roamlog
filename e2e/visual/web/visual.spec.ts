import { test } from "@playwright/test";

import {
  assertVisualRules,
  captureVisualScreenshot,
  gotoAndWait,
  VISUAL_HEIGHTS,
  VISUAL_WIDTHS,
  WEB_ROUTES,
} from "../../a11y/support";

for (const route of WEB_ROUTES) {
  test(`web visual ${route.name} at 1440, 1024, and 390`, async ({ page }) => {
    for (const width of VISUAL_WIDTHS) {
      await page.setViewportSize({ width, height: VISUAL_HEIGHTS[width] });
      await gotoAndWait(page, route);
      await captureVisualScreenshot(page, "web", route.name, width);
      await assertVisualRules(page, `web ${route.name} ${width}px`, {
        titleLimit: route.titleLimit,
        requireH1: route.requireH1,
      });
    }
  });
}
