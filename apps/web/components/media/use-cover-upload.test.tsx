import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  SignedUrlUploadError,
  type CoverMediaClient,
  type PutObjectRequest,
} from "@/lib/api/media";
import { ImageCompressionError } from "@/lib/image/compress-image";
import type { ImageCompressor } from "@/lib/image/use-image-compression";
import type { PhotoExifRead, PhotoExifReader } from "@/lib/image/read-photo-exif";
import {
  COVER_MEDIA_ID,
  COVER_TRIP_ID,
  COVER_WORKSPACE_ID,
  createFakeImageCompressor,
  createFakeMediaClient,
  makeCompressionResult,
  makeCoverTrip,
  makeMedia,
  makeMediaRead,
  makeTripCover,
} from "@/test/cover-upload-doubles";
import { createTestQueryClient } from "@/test/query-harness";

import {
  useCoverUpload,
  type CoverTransition,
  type UseCoverUploadOptions,
} from "./use-cover-upload";

const DEFAULT_POLICY = {
  maxEdge: 2000,
  quality: 0.82,
  targetBytes: 1_500_000,
  maxUploadBytes: 25_000_000,
};

/**
 * The hook normally reads `useMediaCompressionPolicy()` (and therefore the
 * public API). These tests drive the same seam directly so policy changes can
 * be simulated without a network request.
 */
const mediaPolicyState = vi.hoisted(() => ({
  policy: {
    maxEdge: 2000,
    quality: 0.82,
    targetBytes: 1_500_000,
    maxUploadBytes: 25_000_000,
  },
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    useMediaCompressionPolicy: () => mediaPolicyState.policy,
  };
});

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:cover-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

function makeImage(name = "cover.jpg", type = "image/jpeg", size = 2_048): File {
  const file = new File(["image-bytes"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

type ClientOverrides = Partial<CoverMediaClient>;

function setup(
  options: Partial<UseCoverUploadOptions> = {},
  clientOverrides: ClientOverrides = {},
) {
  const queryClient = createTestQueryClient();
  const { client, calls } = createFakeMediaClient(clientOverrides);
  const transitions: CoverTransition[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hookOptions: UseCoverUploadOptions = {
    workspaceId: COVER_WORKSPACE_ID,
    tripId: COVER_TRIP_ID,
    tripVersion: 1,
    client,
    pollIntervalMs: 1,
    processTimeoutMs: 500,
    compressor: vi.fn(createFakeImageCompressor()),
    onTransition: (transition) => transitions.push(transition),
    ...options,
  };
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHook(() => useCoverUpload(hookOptions), { wrapper });
  return { ...view, queryClient, client, calls, transitions, invalidateSpy };
}

describe("useCoverUpload state machine", () => {
  it("runs validating → compressing → presigning → uploading → completing → processing → applying → ready", async () => {
    const onCoverChange = vi.fn();
    const { result, calls, transitions, invalidateSpy } = setup({ onCoverChange });

    act(() => result.current.selectFile(makeImage()));

    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(transitions.map((transition) => transition.phase)).toEqual([
      "validating",
      "compressing",
      "presigning",
      "uploading",
      "completing",
      "processing",
      "applying",
      "ready",
    ]);
    expect(calls.presign).toEqual([
      {
        tripId: COVER_TRIP_ID,
        fileName: "cover.webp",
        mimeType: "image/webp",
        size: 1_536,
      },
    ]);
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0]?.url).toBe(
      "https://storage.example.test/presigned-put?X-Amz-Signature=stub",
    );
    expect(calls.put[0]?.headers).toEqual({ "Content-Type": "image/webp" });
    expect(calls.put[0]?.file.type).toBe("image/webp");
    expect(calls.complete).toEqual([{ mediaId: COVER_MEDIA_ID, input: { size: 1_536 } }]);
    expect(calls.fetch).toEqual([COVER_MEDIA_ID]);
    expect(calls.setCover).toEqual([{ tripId: COVER_TRIP_ID, mediaId: COVER_MEDIA_ID }]);
    expect(result.current.updatedTrip?.coverMediaId).toBe(COVER_MEDIA_ID);
    expect(result.current.updatedTrip?.cover?.url).toBe(makeTripCover().url);
    expect(result.current.error).toBeNull();
    expect(onCoverChange).toHaveBeenCalledWith(
      expect.objectContaining({ coverMediaId: COVER_MEDIA_ID }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["v1", "trip", COVER_TRIP_ID],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["v1", "trips", COVER_WORKSPACE_ID],
    });
  });

  it("reports real PUT progress before the server confirms processing", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const putObject = vi.fn(async (request: PutObjectRequest) => {
      request.onProgress?.(5_000, 10_000);
      await gate;
    });
    const { result } = setup({}, { putObject });

    act(() =>
      result.current.selectFile(makeImage("cover.jpg", "image/jpeg", 10_000)),
    );

    await waitFor(() => expect(result.current.progress).toBe(55));
    expect(result.current.phase).toBe("uploading");
    expect(result.current.canRetry).toBe(false);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });

  it("retries a failed PUT from the upload step without re-compressing or re-presigning", async () => {
    let attempts = 0;
    const putObject = vi.fn(async (request: PutObjectRequest) => {
      attempts += 1;
      if (attempts === 1) {
        throw new SignedUrlUploadError("network", "网络中断");
      }
      request.onProgress?.(request.file.size, request.file.size);
    });
    const compressor = vi.fn(createFakeImageCompressor());
    const { result, calls } = setup({ compressor }, { putObject });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "NETWORK_ERROR",
      resumeAt: "uploading",
      retryable: true,
      message: "网络连接中断，请检查网络后重试。",
    });
    expect(result.current.canRetry).toBe(true);
    expect(result.current.file).not.toBeNull();

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.presign).toHaveLength(1);
    expect(putObject).toHaveBeenCalledTimes(2);
    expect(compressor).toHaveBeenCalledTimes(1);
    expect(calls.complete).toHaveLength(1);
    expect(calls.setCover).toHaveLength(1);
  });

  it("retries a failed complete from the completing step", async () => {
    let completions = 0;
    const complete = vi.fn(async () => {
      completions += 1;
      if (completions === 1) {
        throw new ApiError(500, "处理队列不可用。", "INTERNAL_ERROR");
      }
      return makeMedia({ status: "processing" });
    });
    const { result, calls } = setup({}, { complete });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "SERVER_ERROR",
      resumeAt: "completing",
      retryable: true,
    });

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.presign).toHaveLength(1);
    expect(calls.put).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(calls.fetch).toHaveLength(1);
  });

  it("times out while processing and can resume polling on retry", async () => {
    const fetchMedia = vi.fn(async () =>
      makeMediaRead({ status: "processing", url: null, thumbUrl: null, expiresAt: null }),
    );
    const { result } = setup({ processTimeoutMs: 20, pollIntervalMs: 2 }, { fetchMedia });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "PROCESSING_TIMEOUT",
      resumeAt: "processing",
      retryable: true,
    });
    expect(fetchMedia.mock.calls.length).toBeGreaterThan(1);

    fetchMedia.mockImplementation(async () => makeMediaRead());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(result.current.media?.status).toBe("ready");
  });

  it("surfaces a worker failure and retries by completing again", async () => {
    const fetchMedia = vi.fn(async () =>
      makeMediaRead({
        status: "failed",
        error: "Magic bytes do not match declared image/jpeg",
        url: null,
        thumbUrl: null,
        expiresAt: null,
      }),
    );
    const { result, calls } = setup({}, { fetchMedia });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "PROCESSING_FAILED",
      resumeAt: "completing",
      retryable: true,
      detail: "Magic bytes do not match declared image/jpeg",
    });

    fetchMedia.mockImplementation(async () => makeMediaRead());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.complete).toHaveLength(2);
    expect(calls.put).toHaveLength(1);
  });

  it("classifies an expired signed upload URL and retries from presign", async () => {
    const presign = vi.fn(async (_workspaceId: string, input: { mimeType: string }) => ({
      mediaId: COVER_MEDIA_ID,
      uploadUrl: "https://storage.example.test/expired-put",
      method: "PUT" as const,
      headers: { "Content-Type": input.mimeType },
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }));
    const { result, calls } = setup({}, { presign });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "SIGNED_URL_EXPIRED",
      resumeAt: "presigning",
      retryable: true,
    });
    expect(presign).toHaveBeenCalledTimes(2);
    expect(calls.put).toHaveLength(0);
    expect(calls.complete).toHaveLength(0);
  });

  it("retries when the server reports MEDIA_NOT_READY on set cover", async () => {
    let coverAttempts = 0;
    const setCover = vi.fn(async (tripId: string, mediaId: string) => {
      coverAttempts += 1;
      if (coverAttempts === 1) {
        throw new ApiError(
          409,
          "Only processed media can be used as a trip cover.",
          "MEDIA_NOT_READY",
        );
      }
      return makeCoverTrip({
        id: tripId,
        version: 2,
        coverMediaId: mediaId,
        cover: makeTripCover({ mediaId }),
      });
    });
    const { result, calls } = setup({}, { setCover });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "MEDIA_NOT_READY",
      resumeAt: "processing",
      retryable: true,
      serverCode: "MEDIA_NOT_READY",
    });

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.fetch).toHaveLength(2);
    expect(calls.presign).toHaveLength(1);
    expect(calls.put).toHaveLength(1);
  });

  it("uploads only (no set cover) when the trip does not exist yet", async () => {
    const onMediaReady = vi.fn();
    const onCoverChange = vi.fn();
    const { result, calls } = setup({
      tripId: null,
      tripVersion: null,
      onMediaReady,
      onCoverChange,
    });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.presign[0]?.tripId).toBeUndefined();
    expect(calls.setCover).toHaveLength(0);
    expect(onCoverChange).not.toHaveBeenCalled();
    expect(onMediaReady).toHaveBeenCalledWith(
      expect.objectContaining({ id: COVER_MEDIA_ID, status: "ready" }),
    );
    expect(result.current.previewUrl).toBe("blob:cover-preview");
  });

  it("removes the cover through the versioned trip update and clears local state", async () => {
    const onCoverChange = vi.fn();
    const { result, calls, invalidateSpy } = setup({ tripVersion: 7, onCoverChange });

    act(() => result.current.remove());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.clearCover).toEqual([{ tripId: COVER_TRIP_ID, version: 7 }]);
    expect(result.current.updatedTrip?.cover).toBeNull();
    expect(result.current.previewUrl).toBeNull();
    expect(onCoverChange).toHaveBeenCalledWith(
      expect.objectContaining({ coverMediaId: null, cover: null }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["v1", "trip", COVER_TRIP_ID],
    });
  });

  it("keeps a version conflict retryable and reports the server code", async () => {
    const clearCover = vi.fn(async () => {
      throw new ApiError(409, "Trip was modified by another member.", "VERSION_CONFLICT");
    });
    const { result } = setup({ tripVersion: 4 }, { clearCover });

    act(() => result.current.remove());
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "VERSION_CONFLICT",
      resumeAt: "applying",
      retryable: true,
      serverCode: "VERSION_CONFLICT",
      status: 409,
    });
    expect(result.current.canRetry).toBe(true);
  });

  it.each([
    ["image/gif", "cover.gif", "COVER_TYPE_UNSUPPORTED"],
    ["image/jpeg", "cover.jpg", "COVER_TOO_LARGE"],
  ])("rejects %s before presigning", async (type, name, expectedCode) => {
    const { result, calls } = setup();
    const size = expectedCode === "COVER_TOO_LARGE" ? 25 * 1024 * 1024 + 1 : 1_024;

    act(() => result.current.selectFile(makeImage(name, type, size)));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error?.code).toBe(expectedCode);
    expect(result.current.canRetry).toBe(false);
    expect(calls.presign).toHaveLength(0);
    expect(result.current.file?.name).toBe(name);
  });

  it("keeps the source preview in compose mode and revokes it on reset", async () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const { result } = setup({ tripId: null, tripVersion: null });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.previewUrl).toBe("blob:cover-preview");

    act(() => result.current.reset());

    expect(result.current.phase).toBe("idle");
    expect(result.current.file).toBeNull();
    expect(revokeSpy).toHaveBeenCalledWith("blob:cover-preview");
    revokeSpy.mockRestore();
  });

  it("retries a compression failure from compressing and uploads only once", async () => {
    let attempts = 0;
    const compressor = vi.fn(async (file: File) => {
      attempts += 1;
      if (attempts === 1) {
        throw new ImageCompressionError(
          "ENCODE_FAILED",
          "浏览器无法编码 WebP，图片压缩失败，请重试。",
        );
      }
      return makeCompressionResult({ originalBytes: file.size });
    });
    const { result, calls } = setup({ compressor });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "ENCODE_FAILED",
      resumeAt: "compressing",
      retryable: true,
      message: "浏览器无法编码 WebP，图片压缩失败，请重试。",
    });
    expect(calls.presign).toHaveLength(0);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(compressor).toHaveBeenCalledTimes(2);
    expect(calls.presign).toHaveLength(1);
    expect(calls.put).toHaveLength(1);
  });

  it("surfaces a readable HEIC decode failure instead of uploading silently", async () => {
    const compressor = vi.fn(async () => {
      throw new ImageCompressionError(
        "DECODE_FAILED",
        "该格式浏览器无法解码（HEIC/HEIF）。请先转换为 JPEG 或 PNG 后重试。",
      );
    });
    const { result, calls } = setup({ compressor });

    act(() => result.current.selectFile(makeImage("IMG_0001.HEIC", "image/heic")));
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error).toMatchObject({
      code: "DECODE_FAILED",
      resumeAt: "compressing",
      retryable: true,
    });
    expect(result.current.error?.message).toContain("该格式浏览器无法解码");
    expect(calls.presign).toHaveLength(0);
    expect(calls.put).toHaveLength(0);
  });

  it("cancels an in-flight compression and never starts the upload", async () => {
    let capturedSignal: AbortSignal | undefined;
    const compressor = vi.fn(
      (_file: File, options: { signal?: AbortSignal } = {}) =>
        new Promise<ReturnType<typeof makeCompressionResult>>((_resolve, reject) => {
          capturedSignal = options.signal;
          options.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        }),
    );
    const { result, calls } = setup({ compressor });

    act(() => result.current.selectFile(makeImage()));
    // The phase flips to "compressing" before the compressor is entered, because
    // the pre-compression EXIF read (0014) now runs first and is asynchronous.
    // Wait for the compressor itself, which is what this test is about.
    await waitFor(() => expect(capturedSignal).toBeDefined());

    act(() => result.current.reset());

    expect(result.current.phase).toBe("idle");
    expect(capturedSignal?.aborted).toBe(true);
    expect(calls.presign).toHaveLength(0);
    expect(calls.put).toHaveLength(0);
  });
});

describe("media compression policy consumption", () => {
  afterEach(() => {
    mediaPolicyState.policy = { ...DEFAULT_POLICY };
  });

  it("feeds the policy values into the compressor", async () => {
    mediaPolicyState.policy = {
      maxEdge: 1200,
      quality: 0.9,
      targetBytes: 900_000,
      maxUploadBytes: 8 * 1024 * 1024,
    };
    const compressor = vi.fn(createFakeImageCompressor());
    const { result } = setup({ compressor });

    act(() =>
      result.current.selectFile(makeImage("cover.jpg", "image/jpeg", 5 * 1024 * 1024)),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(compressor).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        maxEdge: 1200,
        quality: 0.9,
        targetBytes: 900_000,
      }),
    );
  });

  it("rejects a file above the policy maxUploadBytes before compressing", async () => {
    mediaPolicyState.policy = {
      ...DEFAULT_POLICY,
      maxUploadBytes: 4 * 1024 * 1024,
    };
    const compressor = vi.fn(createFakeImageCompressor());
    const { result } = setup({ compressor });

    act(() =>
      result.current.selectFile(makeImage("cover.jpg", "image/jpeg", 5 * 1024 * 1024)),
    );
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.error?.code).toBe("COVER_TOO_LARGE");
    expect(compressor).not.toHaveBeenCalled();
  });

  it("uses the changed policy for the next upload without remounting", async () => {
    const compressor = vi.fn(createFakeImageCompressor());
    const { result, rerender } = setup({ compressor });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(compressor.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        maxEdge: 2000,
        quality: 0.82,
        targetBytes: 1_500_000,
      }),
    );

    mediaPolicyState.policy = {
      maxEdge: 1200,
      quality: 0.9,
      targetBytes: 900_000,
      maxUploadBytes: 8 * 1024 * 1024,
    };
    rerender();

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(compressor).toHaveBeenCalledTimes(2));

    expect(compressor.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        maxEdge: 1200,
        quality: 0.9,
        targetBytes: 900_000,
      }),
    );
  });
});
/**
 * 0014: the photo's EXIF is read off the **source** `File` before the compressor
 * redraws it (a canvas re-encode drops the source metadata and the original is
 * never uploaded), and it rides along with the `complete` callback the uploader
 * already posts — no extra request, no extra upload.
 */
describe("pre-compression EXIF (0014)", () => {
  const SNAPSHOT = {
    exif: {
      Make: "Apple",
      Model: "iPhone 15 Pro",
      FNumber: 1.8,
      ExposureTime: "1/250",
      ISO: 200,
      latitude: 31.2304,
      longitude: 121.4737,
    },
    lat: 31.2304,
    lng: 121.4737,
  };

  it("reads the source file before compressing and submits it with `complete`", async () => {
    const order: string[] = [];
    const exifReader: PhotoExifReader = vi.fn(async (file: File) => {
      order.push(`exif:${file.name}`);
      return SNAPSHOT as PhotoExifRead;
    });
    const compressor: ImageCompressor = vi.fn(async (file: File) => {
      order.push(`compress:${file.name}`);
      return makeCompressionResult();
    });
    const { result, calls } = setup({ exifReader, compressor });

    act(() => result.current.selectFile(makeImage("IMG_0001.HEIC", "image/heic")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    // Same file handle, read first: EXIF must survive even though the uploaded
    // object is the re-encoded WebP.
    expect(order).toEqual(["exif:IMG_0001.HEIC", "compress:IMG_0001.HEIC"]);
    expect(calls.presign).toHaveLength(1);
    expect(calls.put).toHaveLength(1);
    expect(calls.complete).toEqual([
      {
        mediaId: COVER_MEDIA_ID,
        input: { size: 1_536, exif: SNAPSHOT.exif, lat: 31.2304, lng: 121.4737 },
      },
    ]);
  });

  it("sends `exif` without coordinates when the photo has none", async () => {
    const exifReader: PhotoExifReader = vi.fn(async () => ({
      exif: { Make: "Canon", Model: "EOS R6" },
      lat: null,
      lng: null,
    }));
    const { result, calls } = setup({ exifReader });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    // The pair is all-or-nothing: a half-position would be a contract error and
    // a database CHECK violation.
    expect(calls.complete[0]?.input).toEqual({
      size: 1_536,
      exif: { Make: "Canon", Model: "EOS R6" },
    });
    expect(calls.complete[0]?.input).not.toHaveProperty("lat");
    expect(calls.complete[0]?.input).not.toHaveProperty("lng");
  });

  it("keeps the request byte-for-byte as before when nothing is readable", async () => {
    const exifReader: PhotoExifReader = vi.fn(async () => null);
    const { result, calls } = setup({ exifReader });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(calls.complete[0]?.input).toEqual({ size: 1_536 });
    expect(calls.complete[0]?.input).not.toHaveProperty("exif");
  });

  it("never lets a failing reader block the upload", async () => {
    const exifReader: PhotoExifReader = vi.fn(async () => {
      throw new Error("corrupt metadata");
    });
    const { result, calls } = setup({ exifReader });

    act(() => result.current.selectFile(makeImage()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    expect(result.current.error).toBeNull();
    expect(result.current.mediaId).toBe(COVER_MEDIA_ID);
    expect(calls.complete).toEqual([{ mediaId: COVER_MEDIA_ID, input: { size: 1_536 } }]);
  });
});
