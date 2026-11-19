import { describe, expect, it, vi } from "vitest";

import { CompleteMediaRequestSchema } from "@roamlog/contracts";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { MediaRecord } from "../media-records.js";
import { MediaUrlService } from "../media-url.service.js";
import { MediaService } from "../media.service.js";
import { presentMedia, presentMediaExif } from "../media.presenter.js";
import { TripCoverService } from "../trip-cover.service.js";

/**
 * 0014: the EXIF the browser read off the source file before compressing it
 * arrives on the `complete` callback and has to survive the write, the read and
 * a hostile row that another schema version (or a hand edit) produced.
 */
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const KEY = "ws/2026/11/media/original.jpg";
const NOW = new Date("2026-11-19T00:00:00.000Z");

const SNAPSHOT = {
  Make: "Apple",
  Model: "iPhone 15 Pro",
  LensModel: "iPhone 15 Pro back triple camera 6.765mm f/1.78",
  FNumber: 1.8,
  ExposureTime: "1/250",
  ISO: 200,
  FocalLength: 24,
  DateTimeOriginal: "2026-11-02T03:04:05.000Z",
  latitude: 31.2304,
  longitude: 121.4737,
};

function mediaRow(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: MEDIA_ID,
    workspaceId: WORKSPACE_ID,
    tripId: null,
    uploaderId: USER_ID,
    bucket: "roamlog-test",
    key: KEY,
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: null,
    variants: {},
    status: "pending",
    error: null,
    caption: null,
    date: null,
    location: null,
    exif: null,
    lat: null,
    lng: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    motion: null,
    ...overrides,
  };
}

function membership(): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: "editor",
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "EXIF",
  };
}

const actor = { user: { id: USER_ID } } as never;

function build(media: MediaRecord) {
  const updateMedia = vi.fn(
    async (_workspaceId: string, mediaId: string, data: Record<string, unknown>) => {
      Object.assign(media, data);
      return { ...media, id: mediaId };
    },
  );
  const repository = {
    findMedia: vi.fn(async () => media),
    updateMedia,
    transaction: async (callback: (tx: unknown) => unknown) => callback({}),
  };
  const storage = {
    completeUpload: vi.fn(async () => ({
      key: KEY,
      size: 4096,
      contentType: "image/jpeg",
      etag: "etag",
    })),
    currentBucket: vi.fn(async () => "roamlog-test"),
    createSignedReadUrl: vi.fn(async (key: string, _bucket?: string | null) => ({
      key,
      url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
      expiresAt: "2026-11-19T12:00:00.000Z",
    })),
  };
  const queue = { enqueue: vi.fn(async () => ({ jobId: "job" })) };
  const activities = { record: vi.fn(async () => ({ id: "activity" })) };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const urls = new MediaUrlService(storage as never, logger as never);
  const service = new MediaService(
    repository as never,
    { findTrip: vi.fn(async () => null) } as never,
    storage as never,
    queue as never,
    new PermissionService(),
    activities as never,
    urls,
    new TripCoverService(urls),
    logger as never,
  );
  return { service, updateMedia };
}

describe("completing an upload with pre-compression EXIF", () => {
  it("persists exif, lat and lng in the same update as the rest of the completion", async () => {
    const { service, updateMedia } = build(mediaRow());

    await service.complete(actor, membership(), MEDIA_ID, {
      size: 4096,
      exif: SNAPSHOT,
      lat: 31.2304,
      lng: 121.4737,
    });

    expect(updateMedia).toHaveBeenCalledTimes(1);
    const data = updateMedia.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(data.exif).toEqual(SNAPSHOT);
    expect(data.lat).toBeCloseTo(31.2304, 6);
    expect(data.lng).toBeCloseTo(121.4737, 6);
    // Metadata rides along with the callback that already existed: no new row,
    // no second write, no extra endpoint.
    expect(data.status).toBe("processing");
  });

  it("leaves the columns NULL when nothing was readable, instead of writing nulls", async () => {
    const { service, updateMedia } = build(mediaRow());

    await service.complete(actor, membership(), MEDIA_ID, { size: 4096 });

    const data = updateMedia.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(data).not.toHaveProperty("exif");
    expect(data).not.toHaveProperty("lat");
    expect(data).not.toHaveProperty("lng");
  });

  it("stores only the curated keys — an unknown tag never reaches the column", async () => {
    const { service, updateMedia } = build(mediaRow());

    await service.complete(actor, membership(), MEDIA_ID, {
      size: 4096,
      exif: { ...SNAPSHOT, Evil: "drop-me", __proto__: { polluted: true } },
    });

    const data = updateMedia.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(data.exif).not.toHaveProperty("Evil");
    expect(Object.keys(data.exif as object)).not.toContain("__proto__");
  });
});

describe("MediaExif contract", () => {
  it("accepts the curated snapshot and rejects unknown top-level request keys", () => {
    expect(
      CompleteMediaRequestSchema.safeParse({ size: 10, exif: SNAPSHOT, lat: 1, lng: 2 }).success,
    ).toBe(true);
    expect(CompleteMediaRequestSchema.safeParse({ nope: true }).success).toBe(false);
  });

  it("rejects a half position as a 400 instead of letting the CHECK fail as a 500", () => {
    expect(CompleteMediaRequestSchema.safeParse({ lat: 31.2 }).success).toBe(false);
    expect(CompleteMediaRequestSchema.safeParse({ lng: 121.4 }).success).toBe(false);
    expect(CompleteMediaRequestSchema.safeParse({ lat: 31.2, lng: 121.4 }).success).toBe(true);
  });

  it("is genuinely optional: absence is legal, an explicit null is not", () => {
    expect(CompleteMediaRequestSchema.safeParse({}).success).toBe(true);
    // Optional must not blur into nullable — the repository has been burned by
    // that confusion before, so `null` is rejected outright.
    expect(CompleteMediaRequestSchema.safeParse({ exif: null }).success).toBe(false);
    expect(CompleteMediaRequestSchema.safeParse({ lat: null }).success).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(CompleteMediaRequestSchema.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(CompleteMediaRequestSchema.safeParse({ lat: 0, lng: 181 }).success).toBe(false);
  });
});

describe("the presenter emits the snapshot explicitly", () => {
  it("projects exif, lat and lng onto the Media contract", () => {
    const media = presentMedia(
      mediaRow({ status: "ready", exif: SNAPSHOT, lat: 31.2304, lng: 121.4737 }),
    );
    expect(media.exif).toEqual(SNAPSHOT);
    expect(media.lat).toBeCloseTo(31.2304, 6);
    expect(media.lng).toBeCloseTo(121.4737, 6);
  });

  it("reports null rather than inventing metadata for a photo without it", () => {
    const media = presentMedia(mediaRow({ status: "ready" }));
    expect(media.exif).toBeNull();
    expect(media.lat).toBeNull();
    expect(media.lng).toBeNull();
  });

  it("never exposes the storage coordinates alongside the EXIF", () => {
    const media = presentMedia(mediaRow({ status: "ready", exif: SNAPSHOT })) as Record<
      string,
      unknown
    >;
    // `bucket`/`key` are legitimately part of `Media`, but they must not be
    // smuggled in *through* the exif blob.
    expect(JSON.stringify(media.exif)).not.toContain(KEY);
  });
});

describe("presentMediaExif hardening", () => {
  it("returns null for anything that is not a plain object", () => {
    expect(presentMediaExif(null)).toBeNull();
    expect(presentMediaExif(undefined)).toBeNull();
    expect(presentMediaExif("not-json")).toBeNull();
    expect(presentMediaExif([SNAPSHOT])).toBeNull();
  });

  it("drops an out-of-range value instead of failing the whole media read", () => {
    // A row written by another schema version, or hand-edited: one bad tag must
    // not turn every read of that photo into a 500.
    const result = presentMediaExif({ ...SNAPSHOT, FNumber: 999 });
    expect(result).not.toBeNull();
    expect(result?.ISO).toBe(200);
    expect(result?.FNumber).toBeUndefined();
  });

  it("keeps a snapshot whose values are all legal", () => {
    expect(presentMediaExif(SNAPSHOT)).toEqual(SNAPSHOT);
  });
});
