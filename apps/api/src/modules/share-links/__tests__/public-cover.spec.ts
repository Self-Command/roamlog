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
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-000000000009";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const SHARE_LINK_ID = "01942f30-1200-7000-8000-000000000004";
const OTHER_TRIP_ID = "01942f30-1200-7000-8000-000000000005";
const MEDIA_READY_ID = "01942f30-1200-7000-8000-000000000010";
const SHARE_TOKEN = "t".repeat(43);
const EXPIRES_AT = "2026-11-18T12:00:00.000Z";
const ORIGINAL_KEY = "ws/2026/11/media/original.jpg";
const LARGE_KEY = "ws/2026/11/media/large.webp";
const THUMB_KEY = "ws/2026/11/media/thumb.webp";

function storageStub() {
  const storage = {
    createSignedReadUrl: async (key: string): Promise<SignedReadUrl> => ({
      url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
      key,
      expiresAt: EXPIRES_AT,
    }),
  };
  return storage as unknown as StorageService;
}

function shareLinkRecord(): ShareLinkRecord {
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
  };
}

function mediaRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEDIA_READY_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: USER_ID,
    bucket: "roamlog-test",
    key: ORIGINAL_KEY,
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    variants: {
      original: { key: ORIGINAL_KEY },
      large: { key: LARGE_KEY },
      thumb: { key: THUMB_KEY },
    },
    status: "ready",
    error: null,
    caption: "Euljiro at dusk",
    location: "Seoul",
    date: new Date("2026-11-11T00:00:00.000Z"),
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
    tags: [],
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

function bundleWith(
  media: Array<Record<string, unknown>>,
  tripOverrides: Record<string, unknown> = {},
  coverMedia: Record<string, unknown> | null = null,
): PublicTripBundle {
  return {
    trip: tripRow(tripOverrides),
    stops: [],
    entries: [],
    media,
    coverMedia,
    budget: null,
  };
}

function buildService(bundle: PublicTripBundle) {
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
    new MediaUrlService(storageStub()),
  );
  return service;
}

describe("ShareLinksService public cover projection", () => {
  it("projects a ready cover of the same trip from signed public media", async () => {
    const service = buildService(
      bundleWith([mediaRow()], { coverMediaId: MEDIA_READY_ID }),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.coverMediaId).toBe(MEDIA_READY_ID);
    expect(payload.trip.cover).toMatchObject({
      mediaId: MEDIA_READY_ID,
      status: "ready",
      url: `https://cdn.example.test/${LARGE_KEY}?X-Amz-Signature=stub`,
      thumbUrl: `https://cdn.example.test/${THUMB_KEY}?X-Amz-Signature=stub`,
      width: 1200,
      height: 800,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      expiresAt: EXPIRES_AT,
    });
    expect(payload.trip.cover).not.toHaveProperty("bucket");
    expect(payload.trip.cover).not.toHaveProperty("key");
    expect(payload.trip.cover).not.toHaveProperty("variants");
    expect(JSON.stringify(payload.trip.cover)).not.toContain("roamlog-test");
  });

  it("projects a Workspace-level cover when the media is not attached to a trip", async () => {
    const service = buildService(
      bundleWith([mediaRow({ tripId: null })], { coverMediaId: MEDIA_READY_ID }),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.cover?.mediaId).toBe(MEDIA_READY_ID);
  });

  it("reports a null cover when the media belongs to another trip", async () => {
    const service = buildService(
      bundleWith([mediaRow({ tripId: OTHER_TRIP_ID })], { coverMediaId: MEDIA_READY_ID }),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.coverMediaId).toBe(MEDIA_READY_ID);
    expect(payload.trip.cover).toBeNull();
  });

  it("reports a null cover when the media is not processed yet", async () => {
    const service = buildService(
      bundleWith([mediaRow({ status: "processing" })], { coverMediaId: MEDIA_READY_ID }),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.cover).toBeNull();
  });

  it("reports a null cover when the media is not part of the public bundle", async () => {
    const service = buildService(bundleWith([], { coverMediaId: MEDIA_READY_ID }));

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.cover).toBeNull();
  });

  it("projects a Workspace-level cover the repository reports outside the gallery", async () => {
    const service = buildService(
      bundleWith([], { coverMediaId: MEDIA_READY_ID }, mediaRow({ tripId: null })),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.cover).toEqual({
      mediaId: MEDIA_READY_ID,
      status: "ready",
      url: `https://cdn.example.test/${LARGE_KEY}?X-Amz-Signature=stub`,
      thumbUrl: `https://cdn.example.test/${THUMB_KEY}?X-Amz-Signature=stub`,
      width: 1200,
      height: 800,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      expiresAt: EXPIRES_AT,
    });
    // The public gallery mirrors the authenticated trip gallery, so a
    // Workspace-level cover must not be smuggled into `media`.
    expect(payload.media).toEqual([]);
  });

  it("keeps storage coordinates out of the public cover", async () => {
    const service = buildService(
      bundleWith([], { coverMediaId: MEDIA_READY_ID }, mediaRow({ tripId: null })),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("roamlog-test");
    expect(serialized).not.toMatch(/bucket|variants|"key"/);
    expect(Object.keys(payload.trip.cover ?? {}).sort()).toEqual([
      "blurhash",
      "expiresAt",
      "height",
      "mediaId",
      "status",
      "thumbUrl",
      "url",
      "width",
    ]);
  });

  it("refuses a cover row from another Workspace even if a bundle carried one", async () => {
    const service = buildService(
      bundleWith(
        [],
        { coverMediaId: MEDIA_READY_ID },
        mediaRow({ tripId: null, workspaceId: OTHER_WORKSPACE_ID }),
      ),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.cover).toBeNull();
    expect(payload.trip.coverMediaId).toBe(MEDIA_READY_ID);
  });

  it.each(["processing", "failed"])(
    "reports a null cover when the cover media is %s",
    async (status) => {
      const service = buildService(
        bundleWith(
          [],
          { coverMediaId: MEDIA_READY_ID },
          mediaRow({ tripId: null, status }),
        ),
      );

      const payload = await service.readPublic(SHARE_TOKEN, {});

      expect(payload.trip.cover).toBeNull();
    },
  );

  it("still answers the rest of the share when the cover cannot be resolved", async () => {
    const service = buildService(
      bundleWith([], { coverMediaId: MEDIA_READY_ID }, mediaRow({ tripId: null })),
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.title).toBe("Seoul, slowly");
    expect(payload.trip.durationDays).toBe(9);
    expect(payload.trip.coverMediaId).toBe(MEDIA_READY_ID);
    expect(payload.trip.cover?.mediaId).toBe(MEDIA_READY_ID);
    expect(payload.stops).toEqual([]);
    expect(payload.entries).toEqual([]);
    expect(payload.budget).toBeNull();
  });
});
