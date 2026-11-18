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
