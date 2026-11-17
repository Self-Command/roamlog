import { expect, test } from "../support/fixtures";
import {
  expectNoHorizontalOverflow,
  KYOTO_TRIP_PATH,
  screenshot,
  WORKSPACE_PATH,
} from "../support/helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("390px core routes do not overflow horizontally", async ({ page }) => {
  const routes = [
    { path: WORKSPACE_PATH, heading: "旅行总览", name: "dashboard" },
    { path: `${WORKSPACE_PATH}/trips`, heading: "旅行库", name: "trips" },
    { path: KYOTO_TRIP_PATH, heading: "京都红叶慢行", name: "trip-detail" },
    { path: `${WORKSPACE_PATH}/journal`, heading: "全部日志", name: "journal" },
    { path: `${WORKSPACE_PATH}/members`, heading: "成员与邀请", name: "members" },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    await expectNoHorizontalOverflow(page, `web 390px ${route.name}`);
    await screenshot(page, `web-390-${route.name}.png`);
  }
});
