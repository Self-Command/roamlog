import { describe, expect, it } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PermissionService } from "../../../common/services/permission.service.js";
import { SanitizeService } from "../../../common/services/sanitize.service.js";
import type { ActivitiesService } from "../../activities/activities.service.js";
import { MediaUrlService } from "../../media/media-url.service.js";
import type { SignedReadUrl, StorageService } from "../../storage/storage.service.js";
import type {
  PublicTripBundle,
  ShareLinkRecord,
  ShareLinksRepository,
} from "../share-links.repository.js";
import { ShareLinksService } from "../share-links.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const SHARE_LINK_ID = "01942f30-1200-7000-8000-000000000004";
const ENTRY_ID = "01942f30-1200-7000-8000-000000000005";
const MEDIA_READY_ID = "01942f30-1200-7000-8000-000000000010";
const MEDIA_PENDING_ID = "01942f30-1200-7000-8000-000000000011";
const MEDIA_KEYLESS_ID = "01942f30-1200-7000-8000-000000000012";
const SHARE_TOKEN = "t".repeat(43);
const EXPIRES_AT = "2026-11-18T12:00:00.000Z";

function storageStub(failKeys: readonly string[] = []) {
  const calls: string[] = [];
  const storage = {
    createSignedReadUrl: async (key: string): Promise<SignedReadUrl> => {
      if (failKeys.includes(key)) {
        throw new Error(`storage unavailable for ${key}`);
      }
      calls.push(key);
      return {
        url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
        key,
        expiresAt: EXPIRES_AT,
      };
    },
  };
  return { storage: storage as unknown as StorageService, calls };
}

function shareLinkRecord(overrides: Partial<ShareLinkRecord> = {}): ShareLinkRecord {
  return {
    id: SHARE_LINK_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    tokenHash: "hash",
    createdById: USER_ID,
    expiresAt: null,
    revokedAt: null,
    passwordHash: null,
    allowIndex: false,
    showBudget: false,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mediaRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEDIA_READY_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: USER_ID,
    bucket: "roamlog-test",
    key: "ws/2026/11/media/original.jpg",
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    variants: {
      original: { key: "ws/2026/11/media/original.jpg" },
      large: { key: "ws/2026/11/media/large.webp" },
      thumb: { key: "ws/2026/11/media/thumb.webp" },
    },
    status: "ready",
    error: null,
    caption: "Euljiro at dusk",
    date: new Date("2026-11-11T00:00:00.000Z"),
    location: "Seoul",
    createdAt: new Date("2026-11-11T00:00:00.000Z"),
    updatedAt: new Date("2026-11-11T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function tripRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Seoul, slowly",
    summary: "A week of food, trains, and rain.",
    status: "active",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    destinations: ["Seoul"],
    countryCodes: ["KR"],
    tags: ["food"],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "public_link",
    favorite: false,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function entryRow(media: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: ENTRY_ID,
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "First night",
    date: new Date("2026-11-10T00:00:00.000Z"),
    location: "Seoul",
    lat: 37.5,
    lng: 127,
    mood: "happy",
    weather: "rain",
    contentHtml: "<p>Safe</p>",
    excerpt: "Arrived late.",
    tags: [],
    media,
  };
}

function bundleWith(
  media: Array<Record<string, unknown>>,
  entryMedia: Array<Record<string, unknown>>,
): PublicTripBundle {
  return {
    trip: tripRow(),
    stops: [],
    entries: [entryRow(entryMedia)],
    media,
    coverMedia: null,
    budget: null,
  };
}

function buildService(bundle: PublicTripBundle | null, failKeys: readonly string[] = []) {
  const { storage, calls } = storageStub(failKeys);
  const repository = {
    findShareLinkByHash: async () => shareLinkRecord(),
    loadPublicTrip: async () => bundle,
    recordAccess: async () => true,
  };
  const service = new ShareLinksService(
    repository as unknown as ShareLinksRepository,
    {} as unknown as PermissionService,
    {} as unknown as ActivitiesService,
    new SanitizeService(),
    {} as unknown as AppConfigService,
    new MediaUrlService(storage),
  );
  return { service, calls };
}

describe("ShareLinksService public read model", () => {
  it("emits durationDays and a null cover for the public trip", async () => {
    const { service } = buildService(bundleWith([], []));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.durationDays).toBe(9);
    expect(payload.trip.cover).toBeNull();
    expect(payload.trip.coverMediaId).toBeNull();
  });

  it("exposes each stop address but never the private bbox", async () => {
    const bundle: PublicTripBundle = {
      ...bundleWith([], []),
      stops: [
        {
          id: "01942f30-1200-7000-8000-000000000020",
          city: "京都",
          country: "日本",
          countryCode: "JP",
          lat: 35.0116,
          lng: 135.7681,
          address: "京都市, 京都府, 日本",
          bbox: [135.6, 34.85, 135.93, 35.17],
          startDate: new Date("2026-11-10T00:00:00.000Z"),
          endDate: new Date("2026-11-12T00:00:00.000Z"),
          notes: "",
          order: 0,
        },
        {
          id: "01942f30-1200-7000-8000-000000000021",
          city: "大阪",
          country: "日本",
          countryCode: "JP",
          lat: null,
          lng: null,
          address: null,
          bbox: null,
          startDate: new Date("2026-11-12T00:00:00.000Z"),
          endDate: new Date("2026-11-14T00:00:00.000Z"),
          notes: "",
          order: 1,
        },
      ],
    };
    const { service } = buildService(bundle);
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.stops.map((stop) => stop.address)).toEqual([
      "京都市, 京都府, 日本",
      null,
    ]);
    // The bbox is planning data: it must not leak to a public visitor, and the
    // strict PublicStop schema would reject the projection if it did.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("bbox");
    expect(serialized).not.toContain("[135.6,34.85");
  });

  it("projects media into the strict PublicMedia shape without storage coordinates", async () => {
    const { service } = buildService(
      bundleWith([mediaRow()], [mediaRow()]),
    );
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media).toHaveLength(1);
    expect(payload.media[0]).toEqual({
      id: MEDIA_READY_ID,
      url: expect.stringContaining("large.webp"),
      thumbUrl: expect.stringContaining("thumb.webp"),
      expiresAt: EXPIRES_AT,
      width: 1200,
      height: 800,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      caption: "Euljiro at dusk",
      date: "2026-11-11",
      location: "Seoul",
      // Live-photo projection: an ordinary still carries no motion and is never
      // mistaken for a playable one.
      livePhoto: false,
      motion: null,
    });
    expect(payload.entries[0]?.media).toEqual(payload.media);
    expect(JSON.stringify(payload)).not.toMatch(/variants|bucket|"key"/);
  });

  it("drops media that is not ready or has no signable object key", async () => {
    const { service, calls } = buildService(
      bundleWith(
        [
          mediaRow(),
          mediaRow({ id: MEDIA_PENDING_ID, status: "processing" }),
          mediaRow({ id: MEDIA_KEYLESS_ID, key: "" }),
        ],
        [mediaRow(), mediaRow({ id: MEDIA_PENDING_ID, status: "processing" })],
      ),
    );
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media.map((item) => item.id)).toEqual([MEDIA_READY_ID]);
    expect(payload.entries[0]?.media.map((item) => item.id)).toEqual([MEDIA_READY_ID]);
    expect(calls.sort()).toEqual([
      "ws/2026/11/media/large.webp",
      "ws/2026/11/media/thumb.webp",
    ]);
  });

  it("still answers with an empty media array when a share has no media", async () => {
    const { service, calls } = buildService(bundleWith([], []));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media).toEqual([]);
    expect(payload.entries[0]?.media).toEqual([]);
    expect(calls).toEqual([]);
    expect(payload.trip.id).toBe(TRIP_ID);
  });

  it("surfaces storage failures instead of returning a fake or empty URL", async () => {
    const { service } = buildService(bundleWith([mediaRow()], []), [
      "ws/2026/11/media/large.webp",
    ]);
    await expect(service.readPublic(SHARE_TOKEN, {})).rejects.toThrow(
      /storage unavailable/,
    );
  });
});

describe("ShareLinksService public place provider", () => {
  function stopRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "01942f30-1200-7000-8000-000000000020",
      tripId: TRIP_ID,
      workspaceId: WORKSPACE_ID,
      city: "京都",
      country: "日本",
      countryCode: "JP",
      lat: 35.0116,
      lng: 135.7681,
      provider: "geoapify",
      providerPlaceId: "geoapify:place/kyoto",
      timeZone: "Asia/Tokyo",
      address: null,
      bbox: null,
      startDate: new Date("2026-11-10T00:00:00.000Z"),
      endDate: new Date("2026-11-12T00:00:00.000Z"),
      notes: "",
      order: 0,
      version: 1,
      createdById: USER_ID,
      updatedById: USER_ID,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedAt: new Date("2026-11-02T00:00:00.000Z"),
      deletedAt: null,
      ...overrides,
    };
  }

  function bundleWithStops(
    stops: Array<Record<string, unknown>>,
    trip: Record<string, unknown> = tripRow(),
  ): PublicTripBundle {
    return { ...bundleWith([], []), trip, stops };
  }

  it("exposes each stop provider and the trip origin provider", async () => {
    const { service } = buildService(
      bundleWithStops(
        [
          stopRow({ provider: "geoapify" }),
          stopRow({ id: "01942f30-1200-7000-8000-000000000021", provider: "photon", order: 1 }),
          stopRow({ id: "01942f30-1200-7000-8000-000000000022", provider: "local", order: 2 }),
        ],
        tripRow({ originProvider: "photon" }),
      ),
    );
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.stops.map((stop) => stop.provider)).toEqual([
      "geoapify",
      "photon",
      "local",
    ]);
    expect(payload.trip.originProvider).toBe("photon");
  });

  it("reports null instead of inventing a provider for legacy rows", async () => {
    const legacyStop = stopRow({ provider: null });
    const legacyTrip = tripRow();
    delete legacyTrip.originProvider;
    const { service } = buildService(bundleWithStops([legacyStop], legacyTrip));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.stops[0]?.provider).toBeNull();
    expect(payload.trip.originProvider).toBeNull();
  });

  it("degrades an unknown future provider value to null instead of failing the strict schema", async () => {
    const { service } = buildService(
      bundleWithStops(
        [stopRow({ provider: "future-provider" })],
        tripRow({ originProvider: "future-provider" }),
      ),
    );
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.stops[0]?.provider).toBeNull();
    expect(payload.trip.originProvider).toBeNull();
  });

  it("projects a full Prisma row with future columns without leaking internal fields", async () => {
    const trip = tripRow({
      originProvider: "geoapify",
      // Columns a later migration (or another module) may add. The public
      // presenter builds the payload key by key, so they must never reach the
      // strict schema — a spread would make the public page 500.
      moderatedAt: new Date("2026-11-19T10:00:00.000Z"),
      moderatedById: USER_ID,
      bucket: "roamlog-private",
      storageKey: "trips/origin/private.jpg",
      lastViewedAt: new Date("2026-11-19T11:00:00.000Z"),
      futureColumn: { nested: true },
    });
    const stop = stopRow({
      provider: "geoapify",
      moderatedAt: new Date("2026-11-19T10:00:00.000Z"),
      moderatedById: USER_ID,
      bucket: "roamlog-private",
      storageKey: "stops/kyoto/private.jpg",
      key: "stops/kyoto/private.jpg",
      variants: { large: { key: "stops/kyoto/large.webp" } },
      futureColumn: "unknown",
    });
    const { service } = buildService({
      ...bundleWith([mediaRow()], []),
      trip,
      stops: [stop],
    });
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.stops[0]?.provider).toBe("geoapify");
    expect(payload.trip.originProvider).toBe("geoapify");

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(
      /moderatedAt|moderatedById|storageKey|bucket|"key"|variants|futureColumn|lastViewedAt/,
    );
  });
});

/**
 * 0014: exact photo GPS on the public page.
 *
 * The product decision is that a shared trip shows where its photos were taken,
 * so the Owner switch (`Trip.showExactPhotoLocation`) defaults to `true`. It is
 * enforced **in the presenter**: when it is off the two keys never enter the
 * payload, so there is nothing for the public page — or anything else reading
 * the response — to un-hide. The rest of the EXIF snapshot never travels at all,
 * because it carries device serial numbers and software versions the public page
 * has no use for.
 */
describe("public photo location switch (0014)", () => {
  const LAT = 37.5665;
  const LNG = 126.978;
  const EXIF_SNAPSHOT = {
    Make: "Apple",
    Model: "iPhone 15 Pro",
    FNumber: 1.8,
    BodySerialNumber: "F2LX00000000",
    Software: "17.4.1",
    latitude: LAT,
    longitude: LNG,
  };

  function photoBundle(trip: Record<string, unknown>): PublicTripBundle {
    // `bundleWith` hardcodes `tripRow()`, so the switch has to be overridden.
    // The row travels in both arms (gallery and entry) exactly like the
    // repository loads it, so the entry copy is checked too.
    const row = mediaRow({ lat: LAT, lng: LNG, exif: EXIF_SNAPSHOT });
    return { ...bundleWith([row], [row]), trip };
  }

  it("emits lat/lng when the switch is on", async () => {
    const { service } = buildService(photoBundle(tripRow({ showExactPhotoLocation: true })));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media).toHaveLength(1);
    expect(payload.media[0]?.lat).toBeCloseTo(LAT, 6);
    expect(payload.media[0]?.lng).toBeCloseTo(LNG, 6);
  });

  it("treats a trip that predates the column as 'show' (the documented default)", async () => {
    const trip = tripRow();
    delete trip.showExactPhotoLocation;
    const { service } = buildService(photoBundle(trip));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media[0]?.lat).toBeCloseTo(LAT, 6);
  });

  it("omits the keys entirely when the switch is off — absence, not a UI hide", async () => {
    const { service } = buildService(photoBundle(tripRow({ showExactPhotoLocation: false })));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media[0]).not.toBeNull();
    // `not.toHaveProperty` rather than `toBeNull`: a `null` would still be a
    // coordinate-shaped payload, and the point is that the coordinates were
    // cropped on the server before serialization.
    expect(payload.media[0]).not.toHaveProperty("lat");
    expect(payload.media[0]).not.toHaveProperty("lng");
    expect(Object.keys(payload.media[0] ?? {})).not.toContain("lat");
    expect(Object.keys(payload.media[0] ?? {})).not.toContain("lng");
    // The whole response, too — not just the gallery copy.
    expect(JSON.stringify(payload)).not.toContain(String(LAT));
    expect(payload.entries[0]?.media[0]).not.toHaveProperty("lat");
  });

  it("never exposes the EXIF snapshot itself, switch on or off", async () => {
    for (const show of [true, false]) {
      const { service } = buildService(photoBundle(tripRow({ showExactPhotoLocation: show })));
      const payload = await service.readPublic(SHARE_TOKEN, {});
      const serialized = JSON.stringify(payload);

      expect(payload.media[0]).not.toHaveProperty("exif");
      // Device identity must not leak through a public share link.
      expect(serialized).not.toContain("F2LX00000000");
      expect(serialized).not.toContain("17.4.1");
      expect(serialized).not.toContain("BodySerialNumber");
      expect(serialized).not.toContain("iPhone 15 Pro");
    }
  });

  it("drops a half-written position instead of publishing an ambiguous point", async () => {
    // The column pair is written together behind a database CHECK, so a row with
    // only one half means it was tampered with; the public read must not fail.
    const { service } = buildService(
      bundleWith([mediaRow({ lat: LAT, lng: null })], []),
    );
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media[0]).not.toHaveProperty("lat");
    expect(payload.media[0]).not.toHaveProperty("lng");
  });

  it("hides the position of a photo that has none, even with the switch on", async () => {
    const { service } = buildService(bundleWith([mediaRow({ lat: null, lng: null })], []));
    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media[0]).not.toHaveProperty("lat");
    expect(payload.media[0]).not.toHaveProperty("lng");
  });
});
