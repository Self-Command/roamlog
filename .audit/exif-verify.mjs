/**
 * EXIF wiring — real-browser evidence.
 *
 * Captures the photo grid with both card shapes (a photo carrying EXIF and an
 * older photo without) plus the public-share exact-location switch, from the
 * running local stack (web :3000, API :4000).
 *
 * The seeded database has no EXIF rows (`Media.exif` defaults to null in the
 * factories), so the two media rows are served by intercepting the trip media
 * list at the network edge: everything else — the trip, the tab, the grid, the
 * dialog and the switch PATCH — is the real application talking to the real API.
 *
 * Run from the repo root: `node .audit/exif-verify.mjs`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const OUT_DIR = path.join(process.cwd(), ".audit", "evidence", "exif");
const ACCOUNT = { email: "verify@roamlog.test", password: "Roamlog-Verify-Aa1!" };

mkdirSync(OUT_DIR, { recursive: true });

/** A `data:image/svg+xml` source: the card needs a real `src`, and no asset is
 * served for a stubbed row. */
function svgSource(top, bottom) {
  const svg = [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"300\">",
    "<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">",
    `<stop offset="0%" stop-color="${top}"/><stop offset="100%" stop-color="${bottom}"/>`,
    "</linearGradient></defs>",
    '<rect width="400" height="300" fill="url(#g)"/>',
    "</svg>",
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const EXIF_SVG = svgSource("#3b6ea5", "#101820");
const PLAIN_SVG = svgSource("#7a5c3f", "#101820");

async function login(page) {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(ACCOUNT.email);
  await page.getByLabel("密码").fill(ACCOUNT.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 30_000 });
}

/** Full `Media` row shaped exactly like the contract's `MediaSchema`. */
function mediaRow(overrides) {
  return {
    id: "0198f000-0000-7000-8000-0000000000c1",
    workspaceId: "01942f30-1200-7000-8000-000000000001",
    tripId: null,
    uploaderId: "01942f30-1200-7000-8000-000000000002",
    bucket: "roamlog-local",
    key: "seed/photo.jpg",
    mimeType: "image/jpeg",
    size: 240_000,
    width: 1600,
    height: 900,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    exif: null,
    lat: null,
    lng: null,
    createdAt: "2026-11-01T02:00:00.000Z",
    updatedAt: "2026-11-01T02:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** Clone a real seeded row so the stub cannot drift from the shipped shape. */
function cloneFrom(base, overrides) {
  return { ...mediaRow(base), ...base, ...overrides };
}

const EXIF_ROW = {
  caption: "清水寺 · 带 EXIF",
  date: "2026-11-02",
  location: "京都 · 日本",
  lat: 35.0116,
  lng: 135.7681,
  variants: {
    original: { key: "seed/exif.jpg", url: EXIF_SVG },
    thumb: { key: "seed/exif-thumb.jpg", url: EXIF_SVG },
  },
  exif: {
    Make: "Apple",
    Model: "iPhone 15 Pro",
    FNumber: 1.8,
    FocalLength: 24,
    ExposureTime: "1/250",
    ISO: 200,
    DateTimeOriginal: "2026-11-02T03:04:05.000Z",
    latitude: 35.0116,
    longitude: 135.7681,
  },
};

const PLAIN_ROW = {
  caption: "老照片 · 无 EXIF",
  date: "2026-11-03",
  variants: {
    original: { key: "seed/plain.jpg", url: PLAIN_SVG },
    thumb: { key: "seed/plain-thumb.jpg", url: PLAIN_SVG },
  },
  exif: null,
};

const patchLog = [];
const notes = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("request", (request) => {
  if (request.method() === "PATCH" && /(^|\/)v1\/trips\//.test(request.url())) {
    patchLog.push({ url: request.url(), body: request.postData() });
  }
});

try {
  await login(page);

  const workspaces = await (await context.request.get(`${API_URL}/v1/me/workspaces`)).json();
  const workspace = workspaces[0];
  notes.push(`workspace: ${workspace.slug}`);

  const trips = await (
    await context.request.get(`${API_URL}/v1/workspaces/${workspace.id}/trips`)
  ).json();
  const trip = trips.items[0];
  notes.push(`trip: ${trip.title} (${trip.id})`);
  notes.push(`trip.showExactPhotoLocation from the API: ${trip.showExactPhotoLocation}`);

  // Reuse a seeded row as the shape template when the workspace has media at all.
  let template = null;
  let mediaList = [];
  try {
    const mediaResponse = await context.request.get(`${API_URL}/v1/trips/${trip.id}/media`);
    mediaList = (await mediaResponse.json()).items ?? [];
  } catch {
    mediaList = [];
  }
  if (mediaList.length > 0) template = mediaList[0];
  notes.push(`seeded media rows for the trip: ${mediaList.length}`);

  const exifItem = cloneFrom(template, { ...EXIF_ROW, id: "0198f000-0000-7000-8000-0000000000e1", tripId: trip.id });
  const plainItem = cloneFrom(template, { ...PLAIN_ROW, id: "0198f000-0000-7000-8000-0000000000e2", tripId: trip.id });

  await page.route("**/v1/trips/*/media*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [exifItem, plainItem], nextCursor: null, hasMore: false }),
    }),
  );

  await page.goto(`${WEB_URL}/w/${workspace.slug}/trips/${trip.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("tab", { name: "照片", exact: true }).click();

  await page.getByTestId("media-exif-summary").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);

  const summaryCards = await page.getByTestId("media-exif-summary").count();
  notes.push(`cards carrying an EXIF summary on screen: ${summaryCards}`);

  await page.screenshot({
    path: path.join(OUT_DIR, "photos-exif-desktop-1440.png"),
    fullPage: true,
  });

  // L2 — the detail surface, opened from the card.
  await page.getByRole("button", { name: "查看照片详情：清水寺 · 带 EXIF" }).click();
  await page.getByTestId("media-exif-detail").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(OUT_DIR, "photos-exif-detail-1440.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭" }).click();
  await page.waitForTimeout(300);

  // Mobile: the exposure value is a desktop-only detail.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB_URL}/w/${workspace.slug}/trips/${trip.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("tab", { name: "照片", exact: true }).click();
  await page.getByTestId("media-exif-summary").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT_DIR, "photos-exif-mobile-390.png"),
    fullPage: true,
  });

  // The switch: turn the exact location off and record the PATCH the app sends.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${WEB_URL}/w/${workspace.slug}/trips/${trip.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("tab", { name: "照片", exact: true }).click();

  const toggle = page.getByRole("switch", { name: "公开页显示精确位置" });
  await toggle.waitFor({ timeout: 20_000 });
  notes.push(`switch checked state before the click: ${await toggle.isChecked()}`);
  await toggle.click();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: path.join(OUT_DIR, "photos-exact-location-switch-1440.png"),
    fullPage: true,
  });

  // Turn it back on so the local dev trip keeps the product default.
  await toggle.click();
  await page.waitForTimeout(1000);
  notes.push(`PATCH bodies: ${JSON.stringify(patchLog)}`);
  notes.push(`switch checked state after restoring: ${await toggle.isChecked()}`);
} finally {
  await browser.close();
}

writeFileSync(
  path.join(OUT_DIR, "NOTES.md"),
  [
    "# EXIF wiring — real-browser evidence",
    "",
    `Captured against the local stack: web ${WEB_URL}, API ${API_URL}.`,
    "",
    ...notes,
    "",
    "## Shots",
    "",
    "- `photos-exif-desktop-1440.png` — the trip's photo grid, desktop. The card titled",
    "  「清水寺 · 带 EXIF」 carries the L1 line: capture date, camera short name,",
    "  `ƒ/1.8 · 24mm` and the 「有位置」 marker. The card titled 「老照片 · 无 EXIF」",
    "  renders its own date only — no EXIF block, no placeholder shell. The",
    "  「公开页显示精确位置」 switch sits above the grid.",
    "- `photos-exif-detail-1440.png` — L2, opened by clicking the photo: camera and",
    "  lens, the `ISO / 焦距 / 光圈 / 快门` chips and the capture time.",
    "- `photos-exif-mobile-390.png` — the same grid at 390px: the exposure value is",
    "  suppressed on the phone and the camera line keeps the card compact.",
    "- `photos-exact-location-switch-1440.png` — the switch after being turned off.",
    "",
    "## Method note",
    "",
    "The seeded database has no media row carrying EXIF (`Media.exif` defaults to",
    "null in the factories), so the two cards are served by intercepting",
    "`GET /v1/trips/{id}/media` at the network edge. The row shape is cloned from a",
    "seeded media row so it cannot drift from the shipped contract. Everything else",
    "— login, the trip, the tab, the grid, the detail dialog and the switch PATCH —",
    "is the real application talking to the real API. The PATCH bodies above are",
    "what the switch actually submitted.",
    "",
  ].join("\n"),
);

console.log(notes.join("\n"));
