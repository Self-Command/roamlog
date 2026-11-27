import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { API_URL, OWNER_ACCOUNT, WORKSPACE_SLUG, WEB_URL, signInViaApi } from "../support/accounts";
import { expectNoHorizontalOverflow } from "../support/helpers";

const OUT_DIR = path.join(process.cwd(), ".audit", "journal-layout");
const RUN_ID = `${Date.now()}`;
const TRIP_TITLE = `E2E Password Share ${RUN_ID}`;
const ENTRY_TITLE = `E2E Password Entry ${RUN_ID}`;
const PASSWORD = "Roamlog-Share-Aa1!";
const WRONG_PASSWORD = "Definitely-Wrong-Aa1!";
const IMAGE_ORIGIN = "https://journal-password-e2e.roamlog.test";

let ownerApi: APIRequestContext;
let workspaceId = "";
let tripId = "";
let entryId = "";
let shareToken = "";
let shareUrl = "";

test.use({ trace: "off", video: "off" });
test.describe.configure({ mode: "serial" });

function svgImage(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#18334a"/>
  <circle cx="500" cy="110" r="58" fill="#f4b860"/>
  <path d="M0 420 140 250 270 380 390 220 640 420V480H0Z" fill="#2f6f62"/>
  <text x="32" y="70" font-family="monospace" font-size="26" fill="white">${label}</text>
</svg>`;
}

async function routeImages(page: Page): Promise<void> {
  await page.context().route(`${IMAGE_ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1) ?? "image";
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: svgImage(name) });
  });
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(OWNER_ACCOUNT.email);
  await page.getByLabel("密码").fill(OWNER_ACCOUNT.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

function fixture() {
  const galleryImage = (index: number) => ({
    src: `${IMAGE_ORIGIN}/gallery-${index}.svg`,
    alt: `图库图片 ${index}`,
    title: null,
    caption: `密码分享图注 ${index}`,
    width: 640,
    height: 480,
    mediaId: null,
  });

  return {
    contentJson: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "受保护的排版正文" }],
        },
        {
          type: "gallery",
          attrs: { columns: 3 },
          content: [1, 2, 3].map((index) => ({
            type: "galleryImage",
            attrs: galleryImage(index),
          })),
        },
        {
          type: "columns",
          attrs: { columns: 2 },
          content: [
            {
              type: "column",
              attrs: { index: 0 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "密码左栏" }] }],
            },
            {
              type: "column",
              attrs: { index: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "密码右栏" }] }],
            },
          ],
        },
      ],
    },
    contentHtml: `
      <h2>受保护的排版正文</h2>
      <div data-type="gallery" data-columns="3">
        ${[1, 2, 3]
          .map(
            (index) => `<figure data-type="gallery-item">
              <img src="${IMAGE_ORIGIN}/gallery-${index}.svg" alt="图库图片 ${index}" width="640" height="480" loading="lazy" decoding="async">
              <figcaption>密码分享图注 ${index}</figcaption>
            </figure>`,
          )
          .join("")}
      </div>
      <div data-type="columns" data-columns="2">
        <div data-type="column" data-column-index="0"><p>密码左栏</p></div>
        <div data-type="column" data-column-index="1"><p>密码右栏</p></div>
      </div>
    `,
  };
}

test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true });
  ownerApi = await playwrightRequest.newContext({ baseURL: API_URL });
  await signInViaApi(ownerApi, OWNER_ACCOUNT);

  const workspacesResponse = await ownerApi.get("/v1/me/workspaces");
  expect(workspacesResponse.status(), await workspacesResponse.text()).toBe(200);
  const workspaces = (await workspacesResponse.json()) as Array<{ id: string; slug: string }>;
  workspaceId = workspaces.find((workspace) => workspace.slug === WORKSPACE_SLUG)?.id ?? "";
  expect(workspaceId, `workspace ${WORKSPACE_SLUG} must exist`).toBeTruthy();

  const tripResponse = await ownerApi.post(`/v1/workspaces/${workspaceId}/trips`, {
    data: {
      title: TRIP_TITLE,
      startDate: "2026-11-22",
      endDate: "2026-11-24",
      origin: "上海",
      destinations: ["京都"],
      countryCodes: ["JP"],
      visibility: "workspace",
    },
  });
  expect(tripResponse.status(), await tripResponse.text()).toBe(201);
  tripId = ((await tripResponse.json()) as { id: string }).id;

  const entryResponse = await ownerApi.post(`/v1/trips/${tripId}/entries`, {
    data: {
      title: ENTRY_TITLE,
      date: "2026-11-22",
      location: "京都",
      mood: "calm",
      weather: "sunny",
      ...fixture(),
      excerpt: "密码分享 SSR 与排版验收",
    },
  });
  expect(entryResponse.status(), await entryResponse.text()).toBe(201);
  entryId = ((await entryResponse.json()) as { id: string }).id;

  const shareResponse = await ownerApi.post(`/v1/trips/${tripId}/share-links`, {
    data: { password: PASSWORD, allowIndex: false, showBudget: false },
  });
  expect(shareResponse.status(), await shareResponse.text()).toBe(201);
  const share = (await shareResponse.json()) as {
    token: string;
    url: string;
    hasPassword: boolean;
  };
  expect(share.hasPassword).toBe(true);
  shareToken = share.token;
  shareUrl = share.url;

  await writeFile(
    path.join(OUT_DIR, "share-password-created.json"),
    JSON.stringify({ workspaceId, tripId, entryId, shareToken, shareUrl }, null, 2),
  );
});

test.afterAll(async () => {
  if (!ownerApi) return;
  if (tripId) {
    const response = await ownerApi.delete(`/v1/trips/${tripId}`);
    expect([200, 204], await response.text()).toContain(response.status());
  }
  await ownerApi.dispose();
});

test("password share never submits before hydration", async ({ page }) => {
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto(`/share/${shareToken}`, { waitUntil: "domcontentloaded" });

  const form = page.locator("form").first();
  const submit = form.locator('button[type="submit"]');
  await expect(form).toHaveAttribute("method", "post");
  await expect(submit).toBeDisabled();

  await page.getByLabel("分享密码").fill(PASSWORD);
  await page.screenshot({
    path: path.join(OUT_DIR, "share-password-prehydration-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  const navigated = page
    .waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 1_500,
    })
    .then(() => true)
    .catch(() => false);
  await page.getByLabel("分享密码").press("Enter");

  expect(await navigated).toBe(false);
  await expect(page).toHaveURL(`${WEB_URL}/share/${shareToken}`);
  expect(page.url()).not.toContain(PASSWORD);
  expect(page.url()).not.toContain(encodeURIComponent(PASSWORD));

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "password share prehydration 390");
  await page.screenshot({
    path: path.join(OUT_DIR, "share-password-prehydration-390.png"),
    fullPage: false,
    animations: "disabled",
  });
});

test("SSR password gate, wrong/correct password, locked reload and responsive layout", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await routeImages(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const anonymous = await playwrightRequest.newContext({ baseURL: WEB_URL });
  try {
    const initial = await anonymous.get(`/share/${shareToken}`);
    expect(initial.status()).toBe(200);
    const initialHtml = await initial.text();
    expect(initialHtml).toContain("输入分享密码");
    expect(initialHtml).toContain("分享密码");
    expect(initialHtml).not.toContain(TRIP_TITLE);
    expect(initialHtml).not.toContain(ENTRY_TITLE);
    expect(initialHtml).not.toContain("密码分享图注 1");
    expect(initialHtml).not.toContain("正在读取分享");
  } finally {
    await anonymous.dispose();
  }

  await page.goto(`/share/${shareToken}`);
  await expect(page.getByRole("heading", { name: "输入分享密码" })).toBeVisible();
  await expect(page.getByLabel("分享密码")).toBeVisible();
  await expect(page.getByText(TRIP_TITLE)).toHaveCount(0);
  await page.screenshot({
    path: path.join(OUT_DIR, "share-password-gate-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const noJsPage = await noJs.newPage();
    await noJsPage.goto(`/share/${shareToken}`);
    await expect(noJsPage.getByRole("heading", { name: "输入分享密码" })).toBeVisible();
    await expect(noJsPage.getByLabel("分享密码")).toBeVisible();
    await expect(noJsPage.getByText(TRIP_TITLE)).toHaveCount(0);
    await expectNoHorizontalOverflow(noJsPage, "password share no-JS 390");
    await noJsPage.screenshot({
      path: path.join(OUT_DIR, "share-password-gate-390.png"),
      fullPage: false,
      animations: "disabled",
    });
  } finally {
    await noJs.close();
  }

  await page.getByLabel("分享密码").fill(WRONG_PASSWORD);
  await page.getByRole("button", { name: "打开分享" }).click();
  await expect(page.getByText("密码不正确，请重新输入。")).toBeVisible();
  await expect(page.getByText(TRIP_TITLE)).toHaveCount(0);

  await page.getByLabel("分享密码").fill(PASSWORD);
  await page.getByRole("button", { name: "打开分享" }).click();
  await expect(page.getByRole("heading", { name: TRIP_TITLE })).toBeVisible();
  await expect(page.getByRole("heading", { name: ENTRY_TITLE })).toBeVisible();

  const article = page.locator(".journal-layout").first();
  await expect(article.locator('div[data-type="gallery"][data-columns="3"]')).toHaveCount(1);
  await expect(article.locator("figure[data-type=gallery-item]")).toHaveCount(3);
  await expect(article.getByText("密码分享图注 2")).toBeVisible();
  await expect(article.locator('div[data-type="columns"][data-columns="2"]')).toHaveCount(1);
  await expectNoHorizontalOverflow(page, "password share unlocked 1440");
  await page.screenshot({
    path: path.join(OUT_DIR, "share-password-unlocked-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  const galleryImage = article.locator("figure[data-type=gallery-item] img").nth(1);
  await galleryImage.click();
  await expect(page.getByRole("dialog", { name: "照片查看" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "照片查看" })).not.toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, "password share unlocked 390");
  const galleryColumns = await article
    .locator('div[data-type="gallery"]')
    .first()
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(/\s+/u).filter(Boolean).length,
    );
  expect(galleryColumns).toBe(2);
  const columnsDirection = await article
    .locator('div[data-type="columns"]')
    .first()
    .evaluate((element) => getComputedStyle(element).flexDirection);
  expect(columnsDirection).toBe("column");

  // The gate copy explicitly says the password is not stored in the browser.
  // A reload therefore returns to the password gate, which is the intended
  // security behavior even though the first draft task asked for persistence.
  await page.reload();
  await expect(page.getByRole("heading", { name: "输入分享密码" })).toBeVisible();
  await expect(page.getByText(TRIP_TITLE)).toHaveCount(0);

  await writeFile(
    path.join(OUT_DIR, "share-password-run.json"),
    JSON.stringify(
      {
        tripId,
        entryId,
        shareToken,
        shareUrl,
        ssrGate: true,
        noJsGate: true,
        wrongPasswordRejected: true,
        correctPasswordUnlocked: true,
        galleryAndColumns: true,
        galleryLightbox: true,
        noHorizontalOverflow: true,
        passwordPersistedAfterReload: false,
        reloadBehavior: "locked_by_design",
      },
      null,
      2,
    ),
  );
});
