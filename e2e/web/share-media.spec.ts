/**
 * SHARE_MEDIA_E2E — signed object-storage media on the public share page.
 *
 * The seed uploads its 24 JPEGs only when `ROAMLOG_SEED_S3_UPLOAD=true`. This
 * journey reads the same public payload the browser reads, then proves the
 * rendered hero (when the trip has a cover) and every photo-wall tile decoded
 * real bytes instead of a broken or placeholder image.
 *
 * 移植来源:
 * - e2e/web/trip-visibility.spec.ts — `trace: "off"`, 1440/390 viewports,
 *   `.audit/<feature>` screenshots and full-page capture pattern.
 * - apps/web/components/share/share-article.tsx:76-84 — hero `<img>` and the
 *   `onError` gradient fallback.
 * - apps/web/components/share/share-article.tsx:351-410 — `SharePhoto` wall,
 *   `figure` tiles, signed `media.url` / `thumbUrl`, and error fallback.
 * - apps/api/src/modules/share-links/share-links.service.ts:218-356 — public
 *   payload projection and signed media URLs.
 *
 * Run:
 *   pnpm exec playwright test e2e/web/share-media.spec.ts --project=web --list
 *   pnpm exec playwright test e2e/web/share-media.spec.ts --project=web
 *
 * Evidence (current code, real stack):
 *   .audit/share-media/desktop-1440-share-media.png
 *   .audit/share-media/mobile-390-share-media.png
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { API_URL } from "../support/accounts";

// Keep in sync with `DEMO_SHARE_TOKEN` in packages/db/src/seed/util.ts.
const SHARE_TOKEN = "roamlog-demo-share-2026-kyoto-trip";
const SHARE_PATH = `/share/${SHARE_TOKEN}`;
const API_PATH = `/v1/public/trips/${SHARE_TOKEN}`;
const SHOT_DIR = resolve(process.cwd(), ".audit/share-media");
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

test.use({ trace: "off" });

interface PublicMedia {
  id: string;
  url: string;
  thumbUrl: string | null;
  caption: string | null;
}

interface PublicTripPayload {
  trip: {
    id: string;
    title: string;
    cover: {
      status?: string;
      url?: string | null;
      thumbUrl?: string | null;
    } | null;
  };
  media: PublicMedia[];
}

interface ImageState {
  complete: boolean;
  naturalWidth: number;
  currentSrc: string;
  src: string | null;
}

function assertHttpUrl(value: string, label: string): void {
  expect(value, `${label} must be an absolute HTTP(S) URL`).toMatch(/^https?:\/\//u);
  expect(value.startsWith("data:"), `${label} must not be a data: URL`).toBe(false);
}

function coverUrlOf(payload: PublicTripPayload): string | null {
  const cover = payload.trip.cover;
  // Mirrors `coverImageUrl` in share-article.tsx: only a ready cover exposes
  // signed bytes; a processing or failed cover keeps the gradient fallback.
  if (!cover || cover.status !== "ready") return null;
  return cover.url ?? cover.thumbUrl ?? null;
}

async function imageState(image: Locator): Promise<ImageState> {
  return image.evaluate((node) => {
    const element = node as HTMLImageElement;
    return {
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      currentSrc: element.currentSrc,
      src: element.getAttribute("src"),
    };
  });
}

async function probeImageUrl(page: Page, url: string): Promise<string> {
  try {
    const response = await page.request.get(url, { timeout: 5_000 });
    return `${response.status()} (${response.headers()["content-type"] ?? "unknown"})`;
  } catch (error) {
    return `request failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function diagnoseImage(
  page: Page,
  label: string,
  src: string,
  currentSrc: string,
): Promise<string> {
  const requested = currentSrc || src;
  const requestedStatus = await probeImageUrl(page, requested);
  const srcStatus = requested === src ? requestedStatus : await probeImageUrl(page, src);
  return [
    `${label}: src=${src}`,
    `currentSrc=${currentSrc || "<none>"}`,
    `http(currentSrc)=${requestedStatus}`,
    `http(src)=${srcStatus}`,
  ].join(" ");
}

/**
 * SSR and the test's independent public-payload request each receive a fresh
 * SigV4 query string, so the signature/date legitimately differ. The object
 * identity is the origin + pathname; the query is only a short-lived grant.
 */
function signedObjectIdentity(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

async function expectImageLoaded(
  page: Page,
  image: Locator,
  label: string,
  expectedSrc: string,
): Promise<void> {
  try {
    await image.scrollIntoViewIfNeeded();
    const initial = await imageState(image);
    expect(
      signedObjectIdentity(initial.src),
      `${label} must render the same signed media object as the public payload`,
    ).toBe(signedObjectIdentity(expectedSrc));

    await expect
      .poll(
        async () => {
          const state = await imageState(image);
          return state.complete && state.naturalWidth > 0;
        },
        { message: `${label} must decode real pixels`, timeout: 20_000 },
      )
      .toBe(true);
  } catch (error) {
    const state = await imageState(image).catch((): ImageState => ({
      complete: false,
      naturalWidth: 0,
      currentSrc: "",
      src: expectedSrc,
    }));
    const diagnosis = await diagnoseImage(page, label, expectedSrc, state.currentSrc);
    throw new Error(
      `${diagnosis}\ncomplete=${state.complete} naturalWidth=${state.naturalWidth}\n${String(error)}`,
    );
  }
}

async function expectPhotoWallCount(
  page: Page,
  photos: Locator,
  expectedSrcs: readonly string[],
): Promise<void> {
  try {
    await expect
      .poll(async () => photos.count(), {
        message: "every public media item must render one photo tile",
        timeout: 20_000,
      })
      .toBe(expectedSrcs.length);
  } catch (error) {
    const rendered = await photos
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).getAttribute("src") ?? "<missing>"),
      )
      .catch(() => []);
    const renderedObjects = new Set(rendered.map((src) => signedObjectIdentity(src)));
    const missing = expectedSrcs.filter((src) => !renderedObjects.has(signedObjectIdentity(src)));
    const diagnostics = await Promise.all(
      missing.map(async (src) => `missing src=${src} http=${await probeImageUrl(page, src)}`),
    );
    throw new Error(
      [
        `photo wall count mismatch: expected ${expectedSrcs.length}, rendered ${rendered.length}`,
        ...diagnostics,
        String(error),
      ].join("\n"),
    );
  }
}

test("公开分享页的封面与照片墙从真实签名 URL 加载", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(SHOT_DIR, { recursive: true });
  await page.setViewportSize(DESKTOP);

  await test.step("打开分享页并等待标题/封面区域", async () => {
    await page.goto(SHARE_PATH);
    await expect(
      page.locator("main > header").or(page.getByRole("alert")),
      "the share page must settle into the article or an explicit error state",
    ).toBeVisible({ timeout: 30_000 });
  });

  let payload: PublicTripPayload | null = null;
  let coverUrl: string | null = null;

  await test.step("公开 API 返回可用的签名媒体 URL", async () => {
    const apiUrl = new URL(API_PATH, `${API_URL.replace(/\/+$/u, "")}/`).toString();
    const response = await page.request.get(apiUrl);
    const body = await response.text();
    expect(response.status(), `GET ${API_PATH} returned ${body}`).toBe(200);

    payload = JSON.parse(body) as PublicTripPayload;
    expect(payload.trip?.title, "public payload must carry the trip title").toBeTruthy();
    expect(Array.isArray(payload.media), "public payload must carry a media array").toBe(true);
    expect(
      payload.media.length,
      "the seed share must expose at least one photo",
    ).toBeGreaterThanOrEqual(1);

    coverUrl = coverUrlOf(payload);
    if (coverUrl) assertHttpUrl(coverUrl, "trip.cover");
    for (const [index, media] of payload.media.entries()) {
      assertHttpUrl(media.url, `media[${index}].url`);
      if (media.thumbUrl) assertHttpUrl(media.thumbUrl, `media[${index}].thumbUrl`);
    }

    const summary = `coverUrl=${coverUrl ?? "<none>"} media=${payload.media.length}`;
    console.log(`[share-media] api=200 ${summary}`);
    test.info().annotations.push({ type: "share-media-payload", description: summary });
  });

  if (!payload) throw new Error("the public share payload was not loaded");
  const publicPayload: PublicTripPayload = payload;

  await test.step("封面与照片墙的 <img> 都完成解码", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(publicPayload.trip.title);

    // The hero is intentionally decorative (`alt=""`), so it has no implicit
    // `img` role. `main > header` is the semantic container from ShareArticle.
    const coverImages = page.locator("main > header img");
    if (coverUrl) {
      try {
        await expect(
          coverImages,
          "the signed cover must render exactly one hero image",
        ).toHaveCount(1);
      } catch (error) {
        throw new Error(
          `cover image missing: src=${coverUrl} http=${await probeImageUrl(page, coverUrl)}\n${String(error)}`,
        );
      }
      const cover = coverImages.first();
      await expectImageLoaded(page, cover, "cover", coverUrl);
    } else {
      test.info().annotations.push({
        type: "cover",
        description:
          "seed trip has no signed cover; the hero renders its designed gradient fallback",
      });
      await expect(coverImages, "a coverless trip must not render a broken <img>").toHaveCount(0);
    }

    const wall = page.getByRole("region", { name: "照片", exact: true });
    await expect(wall, "the PHOTOS section must be visible").toBeVisible();
    // `figure` is the tile container from SharePhoto; this also catches a
    // caption-less photo, which is presentational to assistive technology.
    const photos = wall.locator("figure img");
    await expectPhotoWallCount(
      page,
      photos,
      publicPayload.media.map((media) => media.url),
    );

    const count = await photos.count();
    for (let index = 0; index < count; index += 1) {
      const media = publicPayload.media[index];
      if (!media) throw new Error(`the photo wall rendered an extra tile at index ${index}`);
      await expectImageLoaded(page, photos.nth(index), `photo[${index}]`, media.url);
    }
    console.log(`[share-media] loaded cover=${coverUrl ? 1 : 0} photos=${count}`);
  });

  await test.step("页面没有图片加载失败文案", async () => {
    await expect(
      page.getByText(/图片(加载失败|无法加载)|照片(加载失败|无法加载)|无法加载(图片|照片)/u),
    ).toHaveCount(0);
  });

  await test.step("桌面 1440 全页截图", async () => {
    await page.setViewportSize(DESKTOP);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(SHOT_DIR, "desktop-1440-share-media.png"),
      fullPage: true,
      animations: "disabled",
    });
  });

  await test.step("移动 390 全页截图与横向溢出检查", async () => {
    await page.setViewportSize(MOBILE);
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
        ),
    );
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `mobile layout overflows horizontally: ${JSON.stringify(overflow)}`,
    ).toBe(overflow.clientWidth);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(SHOT_DIR, "mobile-390-share-media.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
});
