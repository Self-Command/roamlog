import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { MediaRecord } from "../media-records.js";
import { MediaUrlService } from "../media-url.service.js";
import { MediaService } from "../media.service.js";
import { TripCoverService } from "../trip-cover.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000ff";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const OTHER_USER_ID = "01942f30-1200-7000-8000-0000000000ee";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const OTHER_TRIP_ID = "01942f30-1200-7000-8000-000000000004";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const ORIGINAL_KEY = "ws/2026/11/media/original.jpg";
const LARGE_KEY = "ws/2026/11/media/large.webp";
const THUMB_KEY = "ws/2026/11/media/thumb.webp";
const NOW = new Date("2026-11-11T00:00:00.000Z");

function mediaRow(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: MEDIA_ID,
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
    exif: null,
    lat: null,
    lng: null,
    date: new Date("2026-11-11T00:00:00.000Z"),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function tripRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Seoul, slowly",
    summary: "",
    status: "active",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    originLat: null,
    originLng: null,
    originCountryCode: null,
    timeZone: null,
    destinations: ["Seoul"],
    countryCodes: ["KR"],
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function membership(
  role: WorkspaceMembershipAccess["role"] = "owner",
  workspaceId: string = WORKSPACE_ID,
): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId,
    userId: USER_ID,
    role,
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "Test Workspace",
  };
}

const actor = { user: { id: USER_ID } } as never;

function build(media: MediaRecord | null, trip: Record<string, unknown> | null = tripRow()) {
  const repository = {
    findMedia: async (workspaceId: string) =>
      media && media.workspaceId === workspaceId ? media : null,
    transaction: async (callback: (tx: unknown) => unknown) => callback({}),
    setTripCover: vi.fn(async (_tx: unknown) => tripRow({ coverMediaId: media?.id ?? null })),
  };
  const trips = { findTrip: async () => trip };
  const activities = { record: async () => ({ id: "activity" }) };
  const storage = {
    createSignedReadUrl: async (key: string) => ({
      key,
      url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
      expiresAt: "2026-11-18T12:00:00.000Z",
    }),
  };
  const urls = new MediaUrlService(storage as never);
  const service = new MediaService(
    repository as never,
    trips as never,
    storage as never,
    {} as never,
    new PermissionService(),
    activities as never,
    urls,
    new TripCoverService(urls),
  );
  return { service, repository };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    return { status: httpError.getStatus?.() ?? 0, body: httpError.getResponse?.() };
  }
  throw new Error("expected the call to reject");
}

describe("GET /v1/media/{mediaId} read model", () => {
  it("returns signed urls and never the storage coordinates", async () => {
    const { service } = build(mediaRow());

    const read = await service.getOne(actor, membership(), MEDIA_ID);

    expect(read).toMatchObject({
      id: MEDIA_ID,
      workspaceId: WORKSPACE_ID,
      tripId: TRIP_ID,
      status: "ready",
      width: 1200,
      height: 800,
      url: `https://cdn.example.test/${LARGE_KEY}?X-Amz-Signature=stub`,
      thumbUrl: `https://cdn.example.test/${THUMB_KEY}?X-Amz-Signature=stub`,
      expiresAt: "2026-11-18T12:00:00.000Z",
    });
    expect(read).not.toHaveProperty("bucket");
    expect(read).not.toHaveProperty("key");
    expect(read).not.toHaveProperty("variants");
    expect(JSON.stringify(read)).not.toContain("roamlog-test");
  });

  it("reports a processing media with its real status and a null url", async () => {
    const { service } = build(mediaRow({ status: "processing" }));

    const read = await service.getOne(actor, membership(), MEDIA_ID);

    expect(read).toMatchObject({
      id: MEDIA_ID,
      status: "processing",
      url: null,
      thumbUrl: null,
      expiresAt: null,
    });
    expect(read).not.toHaveProperty("bucket");
    expect(read).not.toHaveProperty("key");
  });

  it("returns 404 for a media of another Workspace", async () => {
    const { service } = build(mediaRow());

    const failure = await rejection(service.getOne(actor, membership("owner", OTHER_WORKSPACE_ID), MEDIA_ID));

    expect(failure.status).toBe(404);
    expect(failure.body).toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });

  it("returns 404 for an unknown media id", async () => {
    const { service } = build(null);

    const failure = await rejection(service.getOne(actor, membership(), MEDIA_ID));

    expect(failure.status).toBe(404);
    expect(failure.body).toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });

  it("hides media attached to a private trip from members who cannot see it", async () => {
    const { service } = build(
      mediaRow(),
      tripRow({ visibility: "private", createdById: OTHER_USER_ID }),
    );

    const failure = await rejection(service.getOne(actor, membership("editor"), MEDIA_ID));

    expect(failure.status).toBe(404);
    expect(failure.body).toMatchObject({ code: "TRIP_NOT_FOUND" });
  });
});

describe("POST /v1/trips/{tripId}/cover", () => {
  it("sets a ready media of the same trip and projects its url", async () => {
    const { service } = build(mediaRow());

    const trip = await service.setCover(actor, membership(), TRIP_ID, { mediaId: MEDIA_ID });

    expect(trip.coverMediaId).toBe(MEDIA_ID);
    expect(trip.cover).toMatchObject({
      mediaId: MEDIA_ID,
      status: "ready",
      width: 1200,
      height: 800,
      url: `https://cdn.example.test/${LARGE_KEY}?X-Amz-Signature=stub`,
      thumbUrl: `https://cdn.example.test/${THUMB_KEY}?X-Amz-Signature=stub`,
      expiresAt: "2026-11-18T12:00:00.000Z",
    });
    expect(trip.cover).not.toHaveProperty("bucket");
    expect(trip.cover).not.toHaveProperty("key");
    expect(trip.cover).not.toHaveProperty("variants");
  });

  it("accepts a ready Workspace-level media", async () => {
    const { service } = build(mediaRow({ tripId: null }));

    const trip = await service.setCover(actor, membership(), TRIP_ID, { mediaId: MEDIA_ID });

    expect(trip.cover?.mediaId).toBe(MEDIA_ID);
  });

  it("answers 409 for a media that is not processed yet", async () => {
    const { service, repository } = build(mediaRow({ status: "processing" }));

    const failure = await rejection(
      service.setCover(actor, membership(), TRIP_ID, { mediaId: MEDIA_ID }),
    );

    expect(failure.status).toBe(409);
    expect(failure.body).toMatchObject({ code: "MEDIA_NOT_READY" });
    expect(repository.setTripCover).not.toHaveBeenCalled();
  });

  it("answers 422 for a ready media that belongs to another trip", async () => {
    const { service, repository } = build(mediaRow({ tripId: OTHER_TRIP_ID }));

    const failure = await rejection(
      service.setCover(actor, membership(), TRIP_ID, { mediaId: MEDIA_ID }),
    );

    expect(failure.status).toBe(422);
    expect(failure.body).toMatchObject({ code: "MEDIA_TRIP_MISMATCH" });
    expect(repository.setTripCover).not.toHaveBeenCalled();
  });

  it("answers 404 for a media of another Workspace", async () => {
    const { service } = build(mediaRow());

    const failure = await rejection(
      service.setCover(actor, membership("owner", OTHER_WORKSPACE_ID), TRIP_ID, { mediaId: MEDIA_ID }),
    );

    expect(failure.status).toBe(404);
    expect(failure.body).toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });

  it("answers 404 for an unknown trip", async () => {
    const { service } = build(mediaRow(), null);

    const failure = await rejection(
      service.setCover(actor, membership(), TRIP_ID, { mediaId: MEDIA_ID }),
    );

    expect(failure.status).toBe(404);
    expect(failure.body).toMatchObject({ code: "TRIP_NOT_FOUND" });
  });
});
