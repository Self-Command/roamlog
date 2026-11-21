/**
 * PHOTO_UPLOAD_MAP_IMPL — real-browser acceptance for the photo batch upload,
 * the 50-field EXIF panel, the photo map and the YARL viewer.
 *
 * The journey runs against the real stack: the real Next dev server on
 * `http://localhost:3000`, the real API on `:4000`, the seeded Postgres database,
 * the real Better Auth session and the local S3 stub on `:9000`. Nothing is
 * mocked. The only synthetic data is the three PNG files themselves, which are
 * built with a real `eXIf` chunk (see `e2e/support/photo-fixtures.ts`).
 *
 * Run (npx exits 126 on this machine):
 *   node node_modules/@playwright/test/cli.js test e2e/web/trip-photos.spec.ts --project=web --reporter=list
 *
 * Evidence:
 *   .audit/trip-photos/desktop-1440-photos.png
 *   .audit/trip-photos/desktop-1440-trip-map.png
 *   .audit/trip-photos/desktop-1440-viewer.png
 *   .audit/trip-photos/mobile-390-photos.png
 *   .audit/trip-photos/mobile-390-trip-map.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  API_URL,
  OWNER_ACCOUNT,
  WEB_URL,
  signInViaApi,
  type SmokeAccount,
} from "../support/accounts";
import { acceptancePhotos, batchOf } from "../support/photo-fixtures";

const WORKSPACE_SLUG = "roamlog-crew";
const TRIP_TITLE = "京都十一月";
const SHOT_DIR = resolve(process.cwd(), ".audit/trip-photos");
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const FORBIDDEN_COPY = /占位|尚未接入|真实 API|开发中/u;

// The local Windows runner can lose trace files while closing Chromium; this
// journey's evidence is the screenshots plus the measured DOM state.
test.use({ trace: "off" });

test.describe.configure({ mode: "serial" });

interface MediaRow {
  id: string;
  status?: string;
  lat?: number | null;
  lng?: number | null;
  exif?: Record<string, unknown> | null;
  variants?: Partial<
    Record<
      "thumb" | "small" | "medium" | "large" | "display" | "original" | "localFallback",
      { url?: string }
    >
  >;
}

interface StoredSession {
  cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
}

const sessionCache = new Map<string, Promise<StoredSession>>();

/**
 * One real Better Auth sign-in per account, reused by the serial journeys.
 * Logging in through the form for every test trips the production login
 * throttle; the session itself is never mocked.
 */
async function apiSession(account: SmokeAccount): Promise<StoredSession> {
  const cached = sessionCache.get(account.email);
  if (cached) return cached;
  const pending = (async () => {
    const request = await playwrightRequest.newContext({ baseURL: API_URL });
    try {
      await signInViaApi(request, account, WEB_URL, API_URL);
      const state = await request.storageState();
      return { cookies: state.cookies };
    } finally {
      await request.dispose();
    }
  })();
  sessionCache.set(account.email, pending);
  return pending;
}

async function login(page: Page, account: SmokeAccount = OWNER_ACCOUNT): Promise<void> {
  const session = await apiSession(account);
  await page.context().clearCookies();
  await page.context().addCookies(session.cookies);
  await page.goto(`/w/${WORKSPACE_SLUG}`);
}

interface UploadLimits {
  maxFilesPerBatch: number;
  maxFileBytes: number;
  maxBatchBytes: number;
  presignPerMinute: number;
}

interface TripContext {
  id: string;
  workspaceId: string;
  media: MediaRow[];
}

async function resolveTrip(page: Page): Promise<TripContext> {
  const workspacesResponse = await page.request.get("/v1/me/workspaces");
  expect(workspacesResponse.status(), await workspacesResponse.text()).toBe(200);
  const workspaces = (await workspacesResponse.json()) as Array<{ id: string; slug: string }>;
  const workspace = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
  expect(workspace, `workspace ${WORKSPACE_SLUG} must be visible`).toBeTruthy();

  const tripsResponse = await page.request.get(
    `/v1/workspaces/${workspace?.id}/trips?limit=50`,
  );
  expect(tripsResponse.status(), await tripsResponse.text()).toBe(200);
  const tripsBody = (await tripsResponse.json()) as { items?: Array<{ id: string; title: string }> };
  const trip = (tripsBody.items ?? []).find((entry) => entry.title === TRIP_TITLE);
  expect(trip, `trip ${TRIP_TITLE} must exist`).toBeTruthy();

  const mediaResponse = await page.request.get(
    `/v1/trips/${trip?.id}/media?limit=100&sort=createdAt:desc`,
  );
  expect(mediaResponse.status(), await mediaResponse.text()).toBe(200);
  const mediaBody = (await mediaResponse.json()) as { items: MediaRow[] };
  return { id: trip?.id ?? "", workspaceId: workspace?.id ?? "", media: mediaBody.items };
}

/**
 * The server-owned upload limits. `null` means the endpoint is not deployed yet
 * (or answers badly), in which case the journey asserts the number-free copy
 * instead of manufacturing a ceiling the product does not have.
 */
async function readUploadLimits(page: Page, workspaceId: string): Promise<UploadLimits | null> {
  const response = await page.request.get(`/v1/workspaces/${workspaceId}/media/limits`);
  if (response.status() !== 200) return null;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return null;
  const keys = ["maxFilesPerBatch", "maxFileBytes", "maxBatchBytes", "presignPerMinute"] as const;
  for (const key of keys) {
    const value = body[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  }
  return body as unknown as UploadLimits;
}

async function openPhotosTab(page: Page, tripId: string): Promise<void> {
  await page.goto(`/w/${WORKSPACE_SLUG}/trips/${tripId}`);
  await page.getByRole("tab", { name: "照片" }).click();
  await expect(page.getByTestId("photo-upload-open")).toBeVisible({ timeout: 30_000 });
}

/** Opens the upload Dialog and waits for the inline Uppy Dashboard inside it. */
async function openUploader(page: Page): Promise<Locator> {
  await page.getByTestId("photo-upload-open").click();
  const dialog = page.getByRole("dialog").filter({ hasText: "上传旅行照片" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId("photo-upload-dashboard")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30_000 },
  );
  return dialog;
}

async function closeUploaderDialog(dialog: Locator): Promise<void> {
  // The DialogContent renders its own X (aria-label 关闭) plus the footer button;
  // `.last()` targets the footer control.
  await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

function fileInput(dialog: Locator): Locator {
  return dialog.locator('input.uppy-Dashboard-input[type="file"]').first();
}

/**
 * Tiles/style load asynchronously after the canvas exists; screenshots taken
 * before MapLibre's first render show a blank canvas even though the markers are
 * already in the DOM. This only delays the evidence capture, never an assertion.
 */
async function settleMap(page: Page): Promise<void> {
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4_000);
}

/** Media rows currently returned by the API, newest first. */
async function readMedia(page: Page, tripId: string): Promise<MediaRow[]> {
  const response = await page.request.get(
    `/v1/trips/${tripId}/media?limit=100&sort=createdAt:desc`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { items: MediaRow[] }).items;
}

function viewerPath(media: MediaRow): string {
  for (const name of ["display", "large", "medium", "original", "small", "thumb"] as const) {
    const url = media.variants?.[name]?.url;
    if (url) return new URL(url).pathname;
  }
  throw new Error(`media ${media.id} exposes no viewer URL`);
}

async function currentViewerPath(currentImage: Locator): Promise<string | null> {
  const src = await currentImage.getAttribute("src");
  return src ? new URL(src).pathname : null;
}

/**
 * Invites a fresh viewer through the product's invite + Mailpit + accept flow.
 * The owner is already signed in on `page`; credentials are returned for the
 * viewer login. No fixture cookie or mocked role is injected.
 */
async function provisionViewer(
  page: Page,
  workspaceId: string,
): Promise<{ account: SmokeAccount; session: StoredSession }> {
  process.env.ROAMLOG_ACCEPTANCE_API_URL = API_URL;
  process.env.ROAMLOG_ACCEPTANCE_WEB_URL = WEB_URL;
  const { signUpVerifiedAccount, waitForCapturedMail } = await import(
    "../avatar-email/support"
  );

  const account = await signUpVerifiedAccount("photo-viewer");
  const invitation = await page.request.post(`/v1/workspaces/${workspaceId}/invitations`, {
    headers: { origin: WEB_URL },
    data: { email: account.email, role: "viewer" },
  });
  expect([200, 201], await invitation.text()).toContain(invitation.status());

  const mail = await waitForCapturedMail(account.email, (entry) =>
    entry.subject === "邀请加入 Roamlog Crew",
  );
  const link = /https?:\/\/[^\s"'<>]+\/invite\/([A-Za-z0-9_-]+)/u.exec(
    `${mail.text}\n${mail.html}`,
  );
  expect(link, "the invitation mail must contain an accept link").toBeTruthy();

  const viewerRequest = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    await signInViaApi(viewerRequest, account, WEB_URL, API_URL);
    const accepted = await viewerRequest.post(
      `${API_URL}/v1/invitations/${link?.[1] ?? ""}/accept`,
      { headers: { origin: WEB_URL }, data: {} },
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
    const state = await viewerRequest.storageState();
    return { account, session: { cookies: state.cookies } };
  } finally {
    await viewerRequest.dispose();
  }
}

let tripId = "";
let uploadedIds: string[] = [];
let kyotoId = "";

test("批量上传 3 张带 GPS 的 PNG：complete 200、列表出现、刷新后仍在", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);
  await login(page);
  const trip = await resolveTrip(page);
  tripId = trip.id;
  const initialIds = new Set(trip.media.map((row) => row.id));

  const completionStatuses: number[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === "POST" && /\/v1\/media\/[^/]+\/complete$/u.test(path)) {
      completionStatuses.push(response.status());
    }
  });

  await openPhotosTab(page, tripId);
  const dialog = await openUploader(page);
  const limits = await readUploadLimits(page, trip.workspaceId);
  const limitCopy = dialog.getByTestId("photo-upload-limit");
  if (limits) {
    // Every number in the copy is the server's value.
    await expect(limitCopy).toContainText(String(limits.maxFilesPerBatch));
    await expect(limitCopy).toContainText("单张不超过");
  } else {
    // Endpoint unavailable: the dialog must not invent a number.
    await expect(limitCopy).toContainText("超出服务端限制");
    await expect(limitCopy).not.toContainText(/\d+\s*张/u);
  }

  await fileInput(dialog).setInputFiles(acceptancePhotos());
  await expect(dialog.locator(".uppy-Dashboard-Item")).toHaveCount(3, { timeout: 30_000 });

  await dialog.locator(".uppy-StatusBar-actionBtn--upload").click();

  await expect(dialog.getByTestId("photo-upload-summary")).toContainText("3 张照片已上传", {
    timeout: 120_000,
  });
  await expect.poll(() => completionStatuses.length, { timeout: 120_000 }).toBe(3);
  expect(completionStatuses, "every complete callback must answer 200").toEqual([200, 200, 200]);

  // API is the source of truth: exactly three new rows, all carrying GPS.
  await expect
    .poll(async () => (await readMedia(page, tripId)).length, { timeout: 120_000 })
    .toBe(trip.media.length + 3);

  const after = await readMedia(page, tripId);
  const fresh = after.filter((row) => !initialIds.has(row.id));
  expect(fresh).toHaveLength(3);
  uploadedIds = fresh.map((row) => row.id);
  expect(fresh.every((row) => typeof row.lat === "number" && typeof row.lng === "number")).toBe(
    true,
  );
  expect(fresh.every((row) => row.exif && Object.keys(row.exif).length >= 20)).toBe(true);
  kyotoId =
    fresh.find((row) => Math.abs((row.lat ?? 0) - 35.0116) < 0.001)?.id ?? fresh[0]?.id ?? "";
  expect(kyotoId).not.toBe("");

  // The media worker flips the row to `ready` a few seconds after `complete`;
  // the evidence screenshots must show the finished state, not a transient badge.
  await expect
    .poll(
      async () => {
        const rows = await readMedia(page, tripId);
        return rows
          .filter((row) => uploadedIds.includes(row.id))
          .every((row) => row.status === "ready");
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  // Grid refreshed without a manual reload.
  for (const id of uploadedIds) {
    await expect(page.locator(`[data-media-id="${id}"]`)).toBeVisible({ timeout: 60_000 });
  }

  // Close the dialog: the photos tab is what the desktop evidence captures.
  await closeUploaderDialog(dialog);

  // Persisted: a full reload re-reads the rows from the API.
  await page.reload();
  await page.getByRole("tab", { name: "照片" }).click();
  await expect(page.getByTestId("photo-upload-open")).toBeVisible({ timeout: 30_000 });
  for (const id of uploadedIds) {
    await expect(page.locator(`[data-media-id="${id}"]`)).toBeVisible({ timeout: 60_000 });
  }

  // GPS survived the round trip: one map marker per uploaded photo.
  for (const id of uploadedIds) {
    await expect(page.getByTestId(`photo-marker-${id}`)).toBeVisible({ timeout: 60_000 });
  }

  await expect(page.locator("body")).not.toContainText(FORBIDDEN_COPY);
  await settleMap(page);
  await page.screenshot({ path: resolve(SHOT_DIR, "desktop-1440-photos.png"), fullPage: true });
});

test("超过服务端批量上限的照片被拒并给出明确提示", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  const trip = await resolveTrip(page);
  tripId = trip.id;
  const limits = await readUploadLimits(page, trip.workspaceId);
  test.skip(
    limits === null,
    "GET /v1/workspaces/:id/media/limits is not deployed yet (UPLOAD_LIMITS_CONFIG); the UI intentionally shows number-free copy without it.",
  );
  if (!limits) return;
  test.skip(
    limits.maxFilesPerBatch > 40,
    `maxFilesPerBatch=${limits.maxFilesPerBatch} is too large for a UI fixture batch.`,
  );

  const batchSize = limits.maxFilesPerBatch + 1;
  const rejectedName = `verify-batch-${String(batchSize).padStart(2, "0")}.png`;

  await openPhotosTab(page, tripId);
  const dialog = await openUploader(page);
  const limitCopy = dialog.getByTestId("photo-upload-limit");
  // Every number in the copy is the server's value, formatted decimal.
  const megabytes = (bytes: number) =>
    `${bytes % 1_000_000 === 0 ? bytes / 1_000_000 : (bytes / 1_000_000).toFixed(1)} MB`;
  await expect(limitCopy).toContainText(`一次最多 ${limits.maxFilesPerBatch} 张`);
  await expect(limitCopy).toContainText(`单张不超过 ${megabytes(limits.maxFileBytes)}`);
  await expect(limitCopy).toContainText(`单批合计不超过 ${megabytes(limits.maxBatchBytes)}`);
  await expect(limitCopy).toContainText(`每分钟最多上传 ${limits.presignPerMinute} 次`);

  await fileInput(dialog).setInputFiles(batchOf(batchSize));

  const notice = dialog.getByTestId("photo-upload-notice");
  await expect(notice).toBeVisible({ timeout: 60_000 });
  // The rejection copy carries the server's value, not a client constant.
  await expect(notice).toContainText(String(limits.maxFilesPerBatch));
  await expect(notice).toContainText("没有加入上传队列");
  await expect(notice).toContainText(rejectedName);

  // The accepted files stay queued; the extra one is named, never silently lost.
  await expect(dialog.locator(".uppy-Dashboard-Item")).toHaveCount(limits.maxFilesPerBatch, {
    timeout: 60_000,
  });
  await expect(dialog.getByTestId("photo-upload-dashboard")).not.toContainText(rejectedName);

  // Evidence for the server-owned limit copy and the explicit rejection.
  await page.screenshot({ path: resolve(SHOT_DIR, "desktop-1440-upload-dialog-limits.png") });

  // Nothing was uploaded by this test.
  await closeUploaderDialog(dialog);
});

test("EXIF 面板展开可看到多组字段；地图标记打开 YARL；Esc 只关查看器", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  await openPhotosTab(page, tripId);
  expect(kyotoId, "upload test must have produced a Kyoto photo").not.toBe("");

  // 1) EXIF: the detail dialog exposes all stored groups behind one toggle.
  await page.getByTestId(`photo-detail-${kyotoId}`).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "全屏查看" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  const detail = dialog.getByTestId("media-exif-detail");
  const fieldCount = Number(await detail.getAttribute("data-exif-field-count"));
  expect(fieldCount, "the panel must show more than the old 8 fields").toBeGreaterThan(20);

  await dialog.getByTestId("media-exif-toggle").click();
  const fields = dialog.getByTestId("media-exif-fields");
  await expect(fields).toBeVisible();
  await expect(dialog.locator("[data-exif-field]")).toHaveCount(fieldCount);
  for (const group of ["相机 / 镜头 / 署名", "曝光", "时间", "图像", "位置"]) {
    await expect(dialog.getByRole("heading", { name: group })).toBeVisible();
  }
  await expect(dialog.locator('[data-exif-field="GPSAltitude"]')).toContainText("米");
  await expect(dialog.locator('[data-exif-field="Make"]')).toContainText("Roamlog Camera");
  await expect(dialog.locator('[data-exif-field="LensModel"]')).toContainText("RL 24mm f/1.8");

  // 2) YARL over the Radix Dialog: Escape closes only the viewer.
  await dialog.getByRole("button", { name: "全屏查看" }).click();
  const viewer = page.locator('.yarl__root[role="dialog"]');
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  // YARL fades its portal in; wait for the enter transition before the capture.
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(SHOT_DIR, "desktop-1440-viewer.png") });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0, { timeout: 30_000 });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("media-exif-detail")).toBeVisible();

  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // 3) The map marker opens the same viewer directly.
  const kyotoMedia = (await readMedia(page, tripId)).find((row) => row.id === kyotoId);
  expect(kyotoMedia, "the uploaded Kyoto row must still be readable").toBeTruthy();
  const kyotoViewerPath = viewerPath(kyotoMedia as MediaRow);
  const marker = page.getByTestId(`photo-marker-${kyotoId}`);
  await expect(marker).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("photo-map-section").scrollIntoViewIfNeeded();
  // The app shell has a fixed top bar and MapLibre positions markers absolutely,
  // so a coordinate click can land on the bar for a marker near the map's top
  // edge. Dispatching the DOM click on the real button keeps the same handler and
  // the same UI path without depending on that hit-test accident.
  await marker.evaluate((element) => (element as HTMLElement).click());
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer).toHaveAttribute("aria-modal", "true");
  const currentImage = viewer.locator(".yarl__slide_current img.yarl__slide_image");
  await expect
    .poll(() => currentViewerPath(currentImage), { timeout: 30_000 })
    .toBe(kyotoViewerPath);

  // ArrowRight advances to the next photo; ArrowLeft returns to the marker's
  // exact photo. This asserts the image, not merely that the viewer is open.
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => currentViewerPath(currentImage), { timeout: 30_000 })
    .not.toBe(kyotoViewerPath);
  await page.screenshot({ path: resolve(SHOT_DIR, "desktop-1440-viewer-next.png") });
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => currentViewerPath(currentImage), { timeout: 30_000 })
    .toBe(kyotoViewerPath);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0, { timeout: 30_000 });
});

test("行程地图页读取照片层，与停靠点和路线共存", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.goto(`/w/${WORKSPACE_SLUG}/trips/${tripId}/map`);
  await expect(page.getByTestId("trip-map-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("maplibre-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/PHOTOS/u).first()).toBeVisible();
  const toggle = page.getByRole("button", { name: /照片图层/u });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/照片按拍摄位置显示/u)).toBeVisible();
  await expect(page.getByTestId("trip-map-sidebar")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(FORBIDDEN_COPY);
  await settleMap(page);
  await page.screenshot({ path: resolve(SHOT_DIR, "desktop-1440-trip-map.png"), fullPage: true });
});

test("空状态：新旅行没有照片时显示可操作空态，不显示照片地图", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  const resolved = await resolveTrip(page);
  const title = `E2E 空照片 ${Date.now().toString(36)}`;
  const created = await page.request.post(
    `/v1/workspaces/${resolved.workspaceId}/trips`,
    {
      headers: { origin: WEB_URL },
      data: {
        title,
        summary: "PHOTO_UPLOAD_MAP_IMPL empty-state verification",
        startDate: "2027-04-01",
        endDate: "2027-04-02",
      },
    },
  );
  expect([200, 201], await created.text()).toContain(created.status());
  const emptyTripId = ((await created.json()) as { id: string }).id;

  try {
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${emptyTripId}`);
    await page.getByRole("tab", { name: "照片" }).click();
    await expect(page.getByTestId("photo-upload-open")).toBeEnabled();
    await expect(page.getByText("这趟旅行还没有照片", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText("上传照片后，这里会按旅行与日期归档。", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("photo-map-section")).toHaveCount(0);
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-1440-photos-empty.png"),
      fullPage: true,
    });
  } finally {
    await page.request
      .delete(`/v1/trips/${emptyTripId}`, { headers: { origin: WEB_URL } })
      .catch(() => undefined);
  }
});

test("加载态：照片 API 延迟时显示读取中骨架，完成后出现真实照片", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.route("**/v1/trips/*/media?*", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
    await route.continue();
  });

  try {
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${tripId}`);
    await page.getByRole("tab", { name: "照片" }).click();
    await expect(page.getByTestId("photo-upload-open")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("读取中", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("正在打开照片查看…", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-1440-photos-loading.png"),
      fullPage: true,
    });
    await expect(page.locator(`[data-media-id="${uploadedIds[0]}"]`)).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await page.unroute("**/v1/trips/*/media?*");
  }
});

test("错误态：照片 API 503 显示可重试错误，重试后恢复真实网格", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  await page.route("**/v1/trips/*/media?*", async (route) => {
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

  try {
    await page.goto(`/w/${WORKSPACE_SLUG}/trips/${tripId}`);
    await page.getByRole("tab", { name: "照片" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "照片读取失败" });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-1440-photos-error.png"),
      fullPage: true,
    });

    await page.unroute("**/v1/trips/*/media?*");
    await alert.getByRole("button", { name: "重试" }).click();
    await expect(page.locator(`[data-media-id="${uploadedIds[0]}"]`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("alert").filter({ hasText: "照片读取失败" })).toHaveCount(0);
  } finally {
    await page.unroute("**/v1/trips/*/media?*");
  }
});

test("Viewer 只读：上传与删除不可用，直接调用 presign/delete 返回 403", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  const resolved = await resolveTrip(page);
  const viewer = await provisionViewer(page, resolved.workspaceId);

  await page.context().clearCookies();
  await page.context().addCookies(viewer.session.cookies);
  await openPhotosTab(page, tripId);

  const upload = page.getByTestId("photo-upload-open");
  await expect(upload).toBeDisabled();
  await expect(upload).toHaveAttribute(
    "title",
    "Viewer 只能阅读和评论，不能上传照片",
  );
  const deleteButton = page
    .getByTestId(`photo-card-${uploadedIds[0]}`)
    .getByRole("button", { name: /删除照片/u });
  await expect(deleteButton).toBeDisabled();
  await expect(deleteButton).toHaveAttribute(
    "title",
    "Viewer 只能阅读和评论，不能删除照片",
  );

  const presign = await page.request.post(
    `/v1/workspaces/${resolved.workspaceId}/media/presign-batch`,
    {
      headers: { origin: WEB_URL },
      data: {
        tripId,
        files: [{ fileName: "viewer-denied.png", mimeType: "image/png", size: 128 }],
      },
    },
  );
  expect(presign.status(), await presign.text()).toBe(403);
  const denied = await page.request.delete(`/v1/media/${uploadedIds[0]}`, {
    headers: { origin: WEB_URL },
  });
  expect(denied.status(), await denied.text()).toBe(403);
  expect((await readMedia(page, tripId)).some((row) => row.id === uploadedIds[0])).toBe(true);

  await expect(page.getByTestId("photo-map-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("maplibre-canvas").locator("canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: resolve(SHOT_DIR, "desktop-1440-photos-viewer.png"),
    fullPage: true,
  });
});

test("移动端 390：照片 tab 与行程地图无横向溢出", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(MOBILE);
  await login(page);
  await openPhotosTab(page, tripId);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
  await expect(page.getByTestId("photo-map-section")).toBeVisible();
  await settleMap(page);
  await page.screenshot({ path: resolve(SHOT_DIR, "mobile-390-photos.png"), fullPage: true });

  // The uploader itself must stay usable at 390: one Dialog, near-full width,
  // with the inline Uppy Dashboard inside it (no second Uppy modal).
  const dialog = await openUploader(page);
  await expect(fileInput(dialog)).toHaveCount(1);
  await expect(dialog.locator(".uppy-Dashboard-AddFiles").first()).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.width ?? 0).toBeLessThanOrEqual(MOBILE.width);
  expect(dialogBox?.width ?? 0).toBeGreaterThan(MOBILE.width * 0.85);
  const dialogOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(dialogOverflow.scrollWidth).toBeLessThanOrEqual(dialogOverflow.innerWidth + 1);

  // Scroll the Dashboard into the dialog's scroll viewport so the evidence
  // actually shows the picker instead of the dialog's header.
  await dialog.getByTestId("photo-upload-dashboard").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: resolve(SHOT_DIR, "mobile-390-uploader.png") });
  await closeUploaderDialog(dialog);

  await page.goto(`/w/${WORKSPACE_SLUG}/trips/${tripId}/map`);
  await expect(page.getByTestId("trip-map-page")).toBeVisible({ timeout: 30_000 });
  const mapOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(mapOverflow.scrollWidth).toBeLessThanOrEqual(mapOverflow.innerWidth + 1);
  await settleMap(page);
  await page.screenshot({ path: resolve(SHOT_DIR, "mobile-390-trip-map.png"), fullPage: true });
});

test("删除照片：确认后从网格和地图消失，刷新后仍不存在", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  await login(page);
  await openPhotosTab(page, tripId);

  const deletedId = uploadedIds.at(-1);
  expect(deletedId, "the upload test must have produced a photo to delete").toBeTruthy();
  if (!deletedId) return;
  const before = await readMedia(page, tripId);
  expect(before.some((row) => row.id === deletedId)).toBe(true);

  const card = page.getByTestId(`photo-card-${deletedId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: /删除照片/u }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "删除这张照片？" });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await expect(confirm).toContainText(
    "删除后照片不再出现在旅行相册和分享页；存储清理会自动完成。",
  );
  await confirm.getByRole("button", { name: "删除", exact: true }).click();

  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => (await readMedia(page, tripId)).some((row) => row.id === deletedId), {
      timeout: 30_000,
    })
    .toBe(false);

  await page.reload();
  await page.getByRole("tab", { name: "照片" }).click();
  await expect(page.getByTestId("photo-upload-open")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-media-id]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("photo-map-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("maplibre-canvas").locator("canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId(`photo-marker-${uploadedIds[0]}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId(`photo-card-${deletedId}`)).toHaveCount(0);
  await expect(page.getByTestId(`photo-marker-${deletedId}`)).toHaveCount(0);
  await page.screenshot({
    path: resolve(SHOT_DIR, "desktop-1440-photo-deleted.png"),
    fullPage: true,
  });

  uploadedIds = uploadedIds.filter((id) => id !== deletedId);
});
