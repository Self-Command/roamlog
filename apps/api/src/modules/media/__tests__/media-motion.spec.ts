import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { MediaMotionRecord, MediaRecord } from "../media-records.js";
import { MediaUrlService } from "../media-url.service.js";
import { MediaService } from "../media.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01942f30-1200-7000-8000-0000000000ff";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const ORIGINAL_KEY = `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/original.jpg`;
const MOTION_KEY = `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion.mov`;
const NOW = new Date("2026-11-19T00:00:00.000Z");

function mediaRow(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: MEDIA_ID,
    workspaceId: WORKSPACE_ID,
    tripId: null,
    uploaderId: USER_ID,
    bucket: "roamlog-test",
    key: ORIGINAL_KEY,
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: null,
    variants: { original: { key: ORIGINAL_KEY } },
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    motion: null,
    ...overrides,
  };
}

function motionRow(overrides: Partial<MediaMotionRecord> = {}): MediaMotionRecord {
  return {
    id: "01942f30-1200-7000-8000-00000000m001".replace("m", "0"),
    mediaId: MEDIA_ID,
    storageKey: MOTION_KEY,
    thumbKey: null,
    mimeType: "video/quicktime",
    sizeBytes: 2_400_000,
    durationMs: 2_400,
    width: null,
    height: null,
    createdAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function membership(
  role: WorkspaceMembershipAccess["role"] = "editor",
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

function build(media: MediaRecord | null) {
  const upsertMotion = vi.fn(async (data: Parameters<never> | never) => ({
    ...motionRow(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(data as any),
  }));
  const repository = {
    findMedia: async (workspaceId: string) =>
      media && media.workspaceId === workspaceId ? media : null,
    transaction: async (callback: (tx: unknown) => unknown) => callback({}),
    upsertMotion,
    softDelete: vi.fn(async () => 1),
    detachFromContent: vi.fn(async () => undefined),
  };
  const storage = {
    createSignedReadUrl: async (key: string) => ({
      key,
      url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
      expiresAt: "2026-11-19T12:00:00.000Z",
    }),
    createPresignedUpload: vi.fn(async (key: string, contentType: string) => ({
      key,
      url: `https://upload.example.test/${key}`,
      method: "PUT" as const,
      headers: { "Content-Type": contentType },
      expiresAt: "2026-11-19T09:00:00.000Z",
    })),
    completeUpload: vi.fn(async (key: string) => ({
      key,
      size: 2_400_000,
      contentType: "video/quicktime",
      etag: '"etag"',
    })),
  };
  const enqueue = vi.fn(async () => ({ jobId: "job", queue: "media", name: "media.cleanup" }));
  const urls = new MediaUrlService(storage as never);
  const service = new MediaService(
    repository as never,
    {} as never,
    storage as never,
    { enqueue } as never,
    new PermissionService(),
    { record: async () => ({ id: "activity" }) } as never,
    {} as never,
    urls,
  );
  return { service, repository, storage, enqueue, upsertMotion };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    return { status: httpError.getStatus?.() ?? 0, body: httpError.getResponse?.() as Record<string, unknown> };
  }
  throw new Error("expected the call to reject");
}

describe("Live Photo motion API", () => {
  it("presigns the motion object inside the media folder", async () => {
    const { service, storage } = build(mediaRow());

    const presigned = await service.presignMotion(actor, membership(), MEDIA_ID, {
      fileName: "IMG_1.MOV",
      mimeType: "video/quicktime",
      size: 2_400_000,
      durationMs: 2_400,
    });

    expect(presigned).toMatchObject({
      mediaId: MEDIA_ID,
      storageKey: MOTION_KEY,
      method: "PUT",
      headers: { "Content-Type": "video/quicktime" },
    });
    expect(storage.createPresignedUpload).toHaveBeenCalledWith(MOTION_KEY, "video/quicktime");
  });

  it("rejects a motion clip over 50 MB before any storage call", async () => {
    const { service, storage } = build(mediaRow());
    const result = await rejection(
      service.presignMotion(actor, membership(), MEDIA_ID, {
        fileName: "IMG_1.MOV",
        mimeType: "video/quicktime",
        size: 50 * 1024 * 1024 + 1,
      }),
    );

    // The contract schema enforces the ceiling first; either way nothing is signed.
    expect(result.status).toBe(400);
    expect(storage.createPresignedUpload).not.toHaveBeenCalled();
  });

  it("writes MediaMotion from the store's HEAD, not the client's claim", async () => {
    const { service, upsertMotion } = build(mediaRow());

    const read = await service.completeMotion(actor, membership(), MEDIA_ID, {
      storageKey: MOTION_KEY,
      mimeType: "video/quicktime",
      sizeBytes: 1,
      durationMs: 2_400,
    });

    expect(upsertMotion).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: MEDIA_ID,
        storageKey: MOTION_KEY,
        mimeType: "video/quicktime",
        sizeBytes: 2_400_000,
        durationMs: 2_400,
      }),
    );
    expect(read).toMatchObject({
      id: MEDIA_ID,
      livePhoto: true,
      motion: {
        url: `https://cdn.example.test/${MOTION_KEY}?X-Amz-Signature=stub`,
        mimeType: "video/quicktime",
        durationMs: 2_400,
      },
    });
    expect(JSON.stringify(read)).not.toContain("storageKey");
  });

  it("refuses a completion whose key belongs to another folder", async () => {
    const { service, storage } = build(mediaRow());
    const result = await rejection(
      service.completeMotion(actor, membership(), MEDIA_ID, {
        storageKey: `${WORKSPACE_ID}/2026/11/other/original.mov`,
        mimeType: "video/quicktime",
        sizeBytes: 10,
        durationMs: 10,
      }),
    );

    expect(result).toMatchObject({ status: 400, body: { code: "MEDIA_MOTION_KEY_MISMATCH" } });
    expect(storage.completeUpload).not.toHaveBeenCalled();
  });

  it("hides a motion row whose media belongs to another workspace", async () => {
    const { service } = build(mediaRow({ workspaceId: OTHER_WORKSPACE_ID }));

    const read = await rejection(service.completeMotion(actor, membership(), MEDIA_ID, {
      storageKey: MOTION_KEY,
      mimeType: "video/quicktime",
      sizeBytes: 10,
      durationMs: 10,
    }));

    expect(read).toMatchObject({ status: 404, body: { code: "MEDIA_NOT_FOUND" } });
  });

  it("projects livePhoto on a read and nulls it for an ordinary image", async () => {
    const withMotion = build(mediaRow({ motion: motionRow() }));
    const read = await withMotion.service.getOne(actor, membership(), MEDIA_ID);
    expect(read).toMatchObject({ livePhoto: true, motion: { mimeType: "video/quicktime" } });

    const plain = build(mediaRow());
    const plainRead = await plain.service.getOne(actor, membership(), MEDIA_ID);
    expect(plainRead).toMatchObject({ livePhoto: false, motion: null });
  });

  it("treats a soft-deleted motion row as gone", async () => {
    const { service } = build(mediaRow({ motion: motionRow({ deletedAt: NOW }) }));
    const read = await service.getOne(actor, membership(), MEDIA_ID);
    expect(read).toMatchObject({ livePhoto: false, motion: null });
  });

  it("soft-deletes the motion row together with the still", async () => {
    const { service, repository, enqueue } = build(mediaRow({ motion: motionRow() }));

    await service.remove(actor, membership(), MEDIA_ID);

    // The repository soft-deletes both rows inside the caller's transaction.
    expect(repository.softDelete).toHaveBeenCalledTimes(1);
    // The delayed cleanup job also carries the motion object and its thumbnail.
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "media.cleanup",
        data: expect.objectContaining({
          keys: expect.arrayContaining([ORIGINAL_KEY, MOTION_KEY]),
        }),
      }),
    );
  });
});