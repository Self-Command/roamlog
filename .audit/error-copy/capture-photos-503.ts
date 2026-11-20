import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, expect, request, type APIRequestContext } from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, WEB_URL, signInViaApi } from "../../e2e/support/accounts.ts";

const OUT_DIR = resolve(process.cwd(), ".audit/error-copy");
const MEDIA_ROUTE = /\/v1\/trips\/[^/]+\/media(?:\?.*)?$/u;

interface Workspace {
  id: string;
  slug: string;
}

interface Trip {
  id: string;
  title: string;
}

type Cookies = Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];

async function resolveTarget(cookies: Cookies) {
  const api = await request.newContext({ baseURL: API_URL, storageState: { cookies, origins: [] } });
  try {
    const workspacesResponse = await api.get("/v1/me/workspaces");
    if (!workspacesResponse.ok()) {
      throw new Error(`GET /v1/me/workspaces -> ${workspacesResponse.status()}: ${await workspacesResponse.text()}`);
    }
    const workspaces = (await workspacesResponse.json()) as Workspace[];
    const workspace = workspaces.find((entry) => entry.slug === "roamlog-crew") ?? workspaces[0];
    if (!workspace) throw new Error("No workspace is visible to the signed-in owner.");

    const tripsResponse = await api.get(`/v1/workspaces/${workspace.id}/trips?limit=50`);
    if (!tripsResponse.ok()) {
      throw new Error(`GET trips -> ${tripsResponse.status()}: ${await tripsResponse.text()}`);
    }
    const tripsBody = (await tripsResponse.json()) as { items?: Trip[] };
    const trip = tripsBody.items?.find((entry) => entry.title === "京都十一月") ?? tripsBody.items?.[0];
    if (!trip) throw new Error(`No trip is visible in workspace ${workspace.slug}.`);
    return { workspace, trip };
  } finally {
    await api.dispose();
  }
}

async function capture(
  cookies: Cookies,
  target: { workspace: Workspace; trip: Trip },
  viewport: { width: number; height: number },
  screenshotName: string,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  let intercepted = 0;

  await page.route(MEDIA_ROUTE, async (route) => {
    intercepted += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 503,
        error: "Service Unavailable",
        message: "E2E injected media read failure",
      }),
    });
  });

  await page.goto(`${WEB_URL}/w/${target.workspace.slug}/trips/${target.trip.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("tab", { name: "照片" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "照片读取失败" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText("读取失败，请稍后重试。");
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(alert).not.toContainText(/\/v1\/|HTTP 503/u);
  await expect(page.getByText("正在打开照片查看…", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });

  const bodyText = await page.locator("body").innerText();
  if (/\/v1\/|HTTP 503/u.test(bodyText)) {
    throw new Error(`Developer copy leaked into the page: ${bodyText}`);
  }
  if (intercepted === 0) {
    throw new Error("The media request was not intercepted; the 503 state is not genuine.");
  }

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: resolve(OUT_DIR, screenshotName),
    fullPage: true,
    animations: "disabled",
  });

  const evidence = {
    url: page.url(),
    viewport,
    interceptedMediaRequests: intercepted,
    alertText: await alert.innerText(),
    bodyHasApiPath: bodyText.includes("/v1/"),
    bodyHasHttpStatus: bodyText.includes("HTTP 503"),
  };
  await browser.close();
  return evidence;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const auth = await request.newContext({ baseURL: API_URL });
  try {
    await signInViaApi(auth, OWNER_ACCOUNT, WEB_URL, API_URL);
    const state = await auth.storageState();
    const target = await resolveTarget(state.cookies);

    const desktop = await capture(
      state.cookies,
      target,
      { width: 1440, height: 1000 },
      "photos-503-1440.png",
    );
    const mobile = await capture(
      state.cookies,
      target,
      { width: 390, height: 844 },
      "photos-503-390.png",
    );

    const evidence = {
      target: {
        workspace: { id: target.workspace.id, slug: target.workspace.slug },
        trip: { id: target.trip.id, title: target.trip.title },
      },
      desktop,
      mobile,
    };
    await writeFile(
      resolve(OUT_DIR, "photos-503-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await auth.dispose();
  }
}

await main();
