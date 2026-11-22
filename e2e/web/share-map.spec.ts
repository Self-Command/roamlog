import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { API_URL, OWNER_ACCOUNT, WEB_URL, signInViaApi } from "../support/accounts";

const SEED_TOKEN = "roamlog-demo-share-2026-kyoto-trip";
const SHOT_DIR = path.resolve(".audit/share-map");

interface Coordinate {
  lat?: number | null;
  lng?: number | null;
}

interface PublicPayload {
  stops: Array<Coordinate & { id: string }>;
  media: Array<Coordinate & { id: string }>;
  trip: { title: string };
}

function hasFiniteCoordinate(item: Coordinate): boolean {
  return (
    typeof item.lat === "number" &&
    typeof item.lng === "number" &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng)
  );
}

function mapCanvas(page: Page): Locator {
  return page.locator('[data-testid="maplibre-canvas"] canvas.maplibregl-canvas').first();
}

/**
 * Best-effort wait for MapLibre tiles, copied from the atlas layout spec so the
 * evidence screenshots show a painted map instead of a black canvas.
 */
async function waitForMapPaint(page: Page, canvas: Locator, label: string): Promise<number> {
  const deadline = Date.now() + 20_000;
  let luminance = 0;
  while (Date.now() < deadline) {
    try {
      const png = await canvas.screenshot({ animations: "disabled" });
      luminance = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        const context = surface.getContext("2d");
        if (!context) return 0;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        const stride = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);
        let total = 0;
        let samples = 0;
        for (let index = 0; index < pixels.length; index += stride) {
          total +=
            0.2126 * (pixels[index] ?? 0) +
            0.7152 * (pixels[index + 1] ?? 0) +
            0.0722 * (pixels[index + 2] ?? 0);
          samples += 1;
        }
        return samples ? total / samples : 0;
      }, png.toString("base64"));
    } catch {
      luminance = 0;
    }
    if (luminance > 40) break;
    await page.waitForTimeout(750);
  }
  console.log(`[share-map] ${label} canvas mean luminance=${Math.round(luminance)}`);
  return luminance;
}

interface ResolvedShare {
  token: string;
  payload: PublicPayload;
  shareLinkId: string | null;
  source: "seed" | "created";
}

/**
 * Prefer the documented seed link. The local `roamlog_local` database is not
 * guaranteed to have been re-seeded, so when it 404s we create a real share
 * link for a real trip with mapped stops through the authenticated API. The
 * page, API, database and map remain real in both paths.
 */
async function resolveShare(request: APIRequestContext): Promise<ResolvedShare> {
  const seeded = await request.get(`${API_URL}/v1/public/trips/${SEED_TOKEN}`);
  if (seeded.ok()) {
    return {
      token: SEED_TOKEN,
      payload: (await seeded.json()) as PublicPayload,
      shareLinkId: null,
      source: "seed",
    };
  }

  console.log(
    `[share-map] seed token unavailable (${seeded.status()}); creating a real share link for a mapped trip`,
  );
  await signInViaApi(request, OWNER_ACCOUNT);

  const workspacesResponse = await request.get(`${API_URL}/v1/workspaces`);
  expect(workspacesResponse.ok(), await workspacesResponse.text()).toBeTruthy();
  const workspaces = (await workspacesResponse.json()) as Array<{
    id: string;
    slug: string;
    role: string;
  }>;

  for (const workspace of workspaces) {
    if (!["owner", "admin", "editor"].includes(workspace.role)) continue;
    const tripsResponse = await request.get(
      `${API_URL}/v1/workspaces/${workspace.id}/trips?limit=100`,
    );
    if (!tripsResponse.ok()) continue;
    const trips = (await tripsResponse.json()) as {
      items: Array<{ id: string; title: string }>;
    };
    for (const trip of trips.items) {
      const stopsResponse = await request.get(`${API_URL}/v1/trips/${trip.id}/stops`);
      if (!stopsResponse.ok()) continue;
      const stops = (await stopsResponse.json()) as Coordinate[];
      if (!stops.some(hasFiniteCoordinate)) continue;

      const createdResponse = await request.post(`${API_URL}/v1/trips/${trip.id}/share-links`, {
        headers: { origin: WEB_URL },
        data: { showBudget: false },
      });
      expect(createdResponse.status(), await createdResponse.text()).toBe(201);
      const created = (await createdResponse.json()) as { id: string; token: string };

      const publicResponse = await request.get(`${API_URL}/v1/public/trips/${created.token}`);
      expect(publicResponse.ok(), await publicResponse.text()).toBeTruthy();
      console.log(
        `[share-map] using real trip "${trip.title}" in ${workspace.slug} (${created.token.length} char token)`,
      );
      return {
        token: created.token,
        payload: (await publicResponse.json()) as PublicPayload,
        shareLinkId: created.id,
        source: "created",
      };
    }
  }

  throw new Error(
    "No accessible real trip with finite stop coordinates could produce a public share link.",
  );
}

test("SHARE_MAP_READONLY — public route map stays read-only at 1440 and 390", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await mkdir(SHOT_DIR, { recursive: true });

  const share = await resolveShare(request);
  const expectedStops = share.payload.stops.filter(hasFiniteCoordinate).length;
  const expectedPhotos = share.payload.media.filter(hasFiniteCoordinate).length;
  expect(expectedStops, "a mapped stop must exist for the map to render").toBeGreaterThan(0);
  console.log(
    `[share-map] source=${share.source} trip="${share.payload.trip.title}" stops=${share.payload.stops.length} mappedStops=${expectedStops} geotaggedMedia=${expectedPhotos}`,
  );

  try {
    await page.goto(`/share/${share.token}`);
    await expect(page.getByRole("heading", { name: "路线与停靠点", exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const map = page.getByTestId("share-map");
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute("data-mapped-stops", String(expectedStops));
    await expect(map).toHaveAttribute("data-photo-points", String(expectedPhotos));

    const canvas = mapCanvas(page);
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(map.getByRole("button", { name: /^选择停靠点/ }).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await map.getByRole("button", { name: /^选择停靠点/ }).count(),
      "the shared map renders a marker per mapped stop",
    ).toBe(expectedStops);
    expect(
      await page.locator('[data-testid^="trip-map-stop-"]').count(),
      "the existing textual route list is preserved",
    ).toBe(share.payload.stops.length);
    expect(
      await map.getByRole("button", { name: /编辑|删除|添加/ }).count(),
      "no editing affordance is mounted inside the public map",
    ).toBe(0);
    expect(await map.getByText(/编辑|删除|添加节点/).count()).toBe(0);

    await waitForMapPaint(page, canvas, "desktop-1440");
    await page.screenshot({
      path: path.join(SHOT_DIR, "share-map-1440.png"),
      fullPage: true,
      animations: "disabled",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(map).toBeVisible();
    await page.waitForTimeout(500);

    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(
      `[share-map] mobile scrollWidth=${layout.scrollWidth} clientWidth=${layout.clientWidth}`,
    );
    expect(layout.scrollWidth, "390px has no horizontal overflow").toBe(layout.clientWidth);

    const mapBox = await map.boundingBox();
    expect(mapBox?.width ?? 0).toBeLessThanOrEqual(390);

    await page.screenshot({
      path: path.join(SHOT_DIR, "share-map-390.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    if (share.shareLinkId) {
      const revoked = await request.delete(`${API_URL}/v1/share-links/${share.shareLinkId}`, {
        headers: { origin: WEB_URL },
      });
      if (!revoked.ok()) {
        console.log(
          `[share-map] cleanup revoke failed (${revoked.status()}): ${await revoked.text()}`,
        );
      }
    }
  }
});
