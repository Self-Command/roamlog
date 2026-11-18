import { describe, expect, it, vi } from "vitest";

import type { SignedReadUrl, StorageService } from "../../storage/storage.service.js";
import { MediaUrlService } from "../media-url.service.js";
import { TripCoverService, type CoverMediaSource } from "../trip-cover.service.js";

const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const OTHER_TRIP_ID = "01942f30-1200-7000-8000-000000000004";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const ORIGINAL_KEY = "ws/2026/11/media/original.jpg";
const LARGE_KEY = "ws/2026/11/media/large.webp";
const THUMB_KEY = "ws/2026/11/media/thumb.webp";
const EXPIRES_AT = "2026-11-18T12:00:00.000Z";

function storageStub(): StorageService {
  return {
    createSignedReadUrl: async (key: string): Promise<SignedReadUrl> => ({
      key,
      url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
      expiresAt: EXPIRES_AT,
    }),
  } as unknown as StorageService;
}

function source(overrides: Partial<CoverMediaSource> = {}): CoverMediaSource {
  return {
    id: MEDIA_ID,
    key: ORIGINAL_KEY,
    status: "ready",
    variants: {
      original: { key: ORIGINAL_KEY },
      large: { key: LARGE_KEY },
      thumb: { key: THUMB_KEY },
    },
    tripId: TRIP_ID,
    width: 1200,
    height: 800,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    ...overrides,
  };
}

function projector(rows: readonly CoverMediaSource[]) {
  const loader = vi.fn(
    async (_mediaIds: readonly string[]): Promise<CoverMediaSource[]> => [...rows],
  );
  const service = new TripCoverService(new MediaUrlService(storageStub()));
  return { service, loader };
}

describe("TripCoverService", () => {
  it("projects a ready same-trip cover with signed URLs only", async () => {
    const { service, loader } = projector([source()]);
    const covers = await service.resolve([{ id: TRIP_ID, coverMediaId: MEDIA_ID }], loader);
    const cover = covers.get(TRIP_ID);

    expect(loader).toHaveBeenCalledWith([MEDIA_ID]);
    expect(cover).toMatchObject({
      mediaId: MEDIA_ID,
      status: "ready",
      width: 1200,
      height: 800,
      blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      expiresAt: EXPIRES_AT,
    });
    expect(cover?.url).toBe(`https://cdn.example.test/${LARGE_KEY}?X-Amz-Signature=stub`);
    expect(cover?.thumbUrl).toBe(`https://cdn.example.test/${THUMB_KEY}?X-Amz-Signature=stub`);
    expect(cover).not.toHaveProperty("bucket");
    expect(cover).not.toHaveProperty("key");
    expect(cover).not.toHaveProperty("variants");
  });

  it("accepts a Workspace-level (trip-less) ready media as the cover", async () => {
    const { service, loader } = projector([source({ tripId: null })]);
    const covers = await service.resolve([{ id: TRIP_ID, coverMediaId: MEDIA_ID }], loader);

    expect(covers.get(TRIP_ID)?.mediaId).toBe(MEDIA_ID);
  });

  it.each(["processing", "failed"] as const)("reports no cover while the media is %s", async (status) => {
    const { service, loader } = projector([source({ status })]);
    const covers = await service.resolve([{ id: TRIP_ID, coverMediaId: MEDIA_ID }], loader);

    expect(covers.get(TRIP_ID)).toBeNull();
  });

  it("reports no cover when the media belongs to another trip", async () => {
    const { service, loader } = projector([source({ tripId: OTHER_TRIP_ID })]);
    const covers = await service.resolve([{ id: TRIP_ID, coverMediaId: MEDIA_ID }], loader);

    expect(covers.get(TRIP_ID)).toBeNull();
  });

  it("reports no cover when the media is unreachable in this Workspace", async () => {
    const { service, loader } = projector([]);
    const covers = await service.resolve([{ id: TRIP_ID, coverMediaId: MEDIA_ID }], loader);

    expect(covers.get(TRIP_ID)).toBeNull();
  });

  it("skips the media lookup entirely for trips without a cover", async () => {
    const loader = vi.fn(async () => [source()]);
    const service = new TripCoverService(new MediaUrlService(storageStub()));
    const covers = await service.resolve([{ id: TRIP_ID, coverMediaId: null }], loader);

    expect(loader).not.toHaveBeenCalled();
    expect(covers.get(TRIP_ID)).toBeNull();
  });

  it("dedupes the media ids of a page into one loader call", async () => {
    const secondTripId = "01942f30-1200-7000-8000-000000000005";
    const loader = vi.fn(async () => [source({ tripId: null })]);
    const service = new TripCoverService(new MediaUrlService(storageStub()));
    const covers = await service.resolve(
      [
        { id: TRIP_ID, coverMediaId: MEDIA_ID },
        { id: secondTripId, coverMediaId: MEDIA_ID },
      ],
      loader,
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith([MEDIA_ID]);
    expect(covers.get(TRIP_ID)?.mediaId).toBe(MEDIA_ID);
    expect(covers.get(secondTripId)?.mediaId).toBe(MEDIA_ID);
  });
});
