import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeSourceOnlyResult } from "@/lib/image/compress-image";

import {
  stillMimeType,
  useLivePhotoUpload,
  type LivePhotoUploadClient,
} from "./use-live-photo-upload";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";

function file(name: string, type: string, bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function fakeClient(overrides: Partial<LivePhotoUploadClient> = {}): LivePhotoUploadClient {
  return {
    presignStill: vi.fn(async () => ({
      mediaId: MEDIA_ID,
      uploadUrl: "https://media.test/still",
      method: "PUT" as const,
      headers: { "Content-Type": "image/webp" },
      expiresAt: "2026-11-19T09:00:00.000Z",
    })),
    putObject: vi.fn(async () => undefined),
    completeStill: vi.fn(async () => ({
      id: MEDIA_ID,
      workspaceId: WORKSPACE_ID,
      tripId: null,
      uploaderId: "01942f30-1200-7000-8000-000000000002",
      bucket: "b",
      key: "k/original.webp",
      mimeType: "image/webp",
      size: 10,
      width: 800,
      height: 600,
      blurhash: null,
      variants: {},
      status: "processing" as const,
      error: null,
      caption: null,
      date: null,
      location: null,
      createdAt: "2026-11-19T08:00:00.000Z",
      updatedAt: "2026-11-19T08:00:00.000Z",
      deletedAt: null,
      livePhoto: false,
      motion: null,
    })),
    presignMotion: vi.fn(async () => ({
      mediaId: MEDIA_ID,
      storageKey: `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/motion.mov`,
      uploadUrl: "https://media.test/motion",
      method: "PUT" as const,
      headers: { "Content-Type": "video/quicktime" },
      expiresAt: "2026-11-19T09:00:00.000Z",
    })),
    completeMotion: vi.fn(async () => ({
      id: MEDIA_ID,
      workspaceId: WORKSPACE_ID,
      tripId: null,
      uploaderId: "01942f30-1200-7000-8000-000000000002",
      mimeType: "image/webp",
      size: 10,
      width: 800,
      height: 600,
      blurhash: null,
      status: "processing" as const,
      error: null,
      caption: null,
      date: null,
      location: null,
      createdAt: "2026-11-19T08:00:00.000Z",
      updatedAt: "2026-11-19T08:00:00.000Z",
      deletedAt: null,
      url: "https://media.test/still?sig=1",
      thumbUrl: null,
      expiresAt: "2026-11-19T09:00:00.000Z",
      livePhoto: true,
      motion: {
        url: "https://media.test/motion?sig=1",
        mimeType: "video/quicktime" as const,
        durationMs: 2400,
      },
    })),
    ...overrides,
  };
}

function options(client: LivePhotoUploadClient, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    client,
    compress: vi.fn(async () => makeSourceOnlyResult(new Blob([new Uint8Array(4)]))),
    probeDuration: vi.fn(async () => 2_400),
    ...overrides,
  } as never;
}

describe("useLivePhotoUpload", () => {
  it("uploads the still first and then the paired motion", async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useLivePhotoUpload(options(client)));

    await act(async () => {
      await result.current.upload([
        file("IMG_1.HEIC", "image/heic"),
        file("IMG_1.MOV", "video/quicktime"),
      ]);
    });

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(client.presignStill).toHaveBeenCalledTimes(1);
    expect(client.completeStill).toHaveBeenCalledTimes(1);
    expect(client.presignMotion).toHaveBeenCalledWith(
      WORKSPACE_ID,
      MEDIA_ID,
      expect.objectContaining({ mimeType: "video/quicktime", size: 4 }),
    );
    // The movie is uploaded as-is, not re-encoded.
    expect(client.putObject).toHaveBeenCalledTimes(2);
    expect(result.current.items[0]).toMatchObject({
      livePhoto: true,
      mediaId: MEDIA_ID,
      motionError: null,
    });
    expect(result.current.items[0]?.liveMedia?.motion?.url).toBe(
      "https://media.test/motion?sig=1",
    );
    expect(result.current.unpaired).toEqual([]);
  });

  it("keeps the still and reports a readable reason when the movie is too large", async () => {
    const client = fakeClient();
    const { result } = renderHook(() =>
      useLivePhotoUpload(options(client, { maxMotionBytes: 3 })),
    );

    await act(async () => {
      await result.current.upload([
        file("IMG_2.JPG", "image/jpeg"),
        file("IMG_2.MOV", "video/quicktime", 10),
      ]);
    });

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(client.presignMotion).not.toHaveBeenCalled();
    expect(result.current.items[0]?.mediaId).toBe(MEDIA_ID);
    expect(result.current.items[0]?.motionError).toContain("动图需小于");
    expect(result.current.items[0]?.livePhoto).toBe(false);
  });

  it("surfaces files that did not pair instead of dropping them", async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useLivePhotoUpload(options(client)));
    const extraMotion = file("IMG_3.MOV", "video/quicktime");
    const loneStill = file("IMG_9.JPG", "image/jpeg");

    await act(async () => {
      await result.current.upload([
        file("IMG_3.JPG", "image/jpeg"),
        extraMotion,
        file("IMG_3.MOV", "video/quicktime"),
        loneStill,
      ]);
    });

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // One pair uploaded; the surplus movie and the lone still are reported.
    expect(result.current.unpaired).toEqual([extraMotion, loneStill]);
    expect(client.presignMotion).toHaveBeenCalledTimes(1);
  });

  it("maps extensions to the presign allow-list when the browser reports no MIME", () => {
    expect(stillMimeType({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
    expect(stillMimeType({ name: "IMG_1.jpg", type: "" })).toBe("image/jpeg");
    expect(stillMimeType({ name: "weird.bin", type: "" })).toBe("image/jpeg");
  });
});