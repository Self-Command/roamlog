import { ProblemDetailsSchema } from "@roamlog/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  presignMediaUpload: vi.fn(),
  completeMediaUpload: vi.fn(),
  getMedia: vi.fn(),
  setTripCover: vi.fn(),
  updateTrip: vi.fn(),
}));

vi.mock("@roamlog/api-client", () => api);

import {
  COVER_MEDIA_ID,
  COVER_TRIP_ID,
  COVER_WORKSPACE_ID,
  makeCoverTrip,
  makeMedia,
  makeMediaRead,
  makeTripCover,
} from "@/test/cover-upload-doubles";

import {
  createCoverMediaClient,
  putObjectToSignedUrl,
  type PutObjectRequest,
} from "./media";

function response(data: unknown, status = 200) {
  return { data, status, headers: new Headers() };
}

class FakeXhr {
  static instances: FakeXhr[] = [];

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  readonly open = vi.fn();
  readonly setRequestHeader = vi.fn();
  readonly send = vi.fn();
  readonly abort = vi.fn();

  constructor() {
    FakeXhr.instances.push(this);
  }
}

function latestXhr(): FakeXhr {
  const xhr = FakeXhr.instances.at(-1);
  if (!xhr) throw new Error("No fake XMLHttpRequest was created.");
  return xhr;
}

function makeRequest(overrides: Partial<PutObjectRequest> = {}): PutObjectRequest {
  const file = new File(["image-bytes"], "cover.jpg", { type: "image/jpeg" });
  return {
    url: "https://storage.example.test/presigned-put?X-Amz-Signature=stub",
    headers: { "Content-Type": "image/jpeg" },
    file,
    ...overrides,
  };
}

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("putObjectToSignedUrl", () => {
  it("PUTs to the server-signed URL with the server headers and reports progress", async () => {
    const onProgress = vi.fn();
    const request = makeRequest({ onProgress });

    const promise = putObjectToSignedUrl(request);
    const xhr = latestXhr();

    expect(xhr.open).toHaveBeenCalledWith("PUT", request.url, true);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(xhr.send).toHaveBeenCalledWith(request.file);

    xhr.upload.onprogress?.({
      lengthComputable: true,
      loaded: 512,
      total: 1_024,
    } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(512, 1_024);

    xhr.status = 200;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenLastCalledWith(request.file.size, request.file.size);
  });

  it("rejects with the storage status so callers can classify 413", async () => {
    const promise = putObjectToSignedUrl(makeRequest());
    const xhr = latestXhr();

    xhr.status = 413;
    xhr.onload?.();

    await expect(promise).rejects.toMatchObject({ code: "http", status: 413 });
  });

  it("rejects network failures without swallowing them", async () => {
    const promise = putObjectToSignedUrl(makeRequest());
    latestXhr().onerror?.();

    await expect(promise).rejects.toMatchObject({ code: "network" });
  });

  it("aborts the XHR when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const promise = putObjectToSignedUrl(makeRequest({ signal: controller.signal }));
    const xhr = latestXhr();

    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(xhr.abort).toHaveBeenCalled();
  });
});

describe("createCoverMediaClient", () => {
  it("uses the generated presign endpoint and validates its response", async () => {
    api.presignMediaUpload.mockResolvedValue(
      response({
        mediaId: COVER_MEDIA_ID,
        uploadUrl: "https://storage.example.test/presigned-put?X-Amz-Signature=stub",
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        expiresAt: "2026-11-18T23:59:59.000Z",
      }),
    );
    const client = createCoverMediaClient();
    const input = { fileName: "cover.png", mimeType: "image/png", size: 1_024 };

    const result = await client.presign(COVER_WORKSPACE_ID, input);

    expect(api.presignMediaUpload).toHaveBeenCalledWith(COVER_WORKSPACE_ID, input);
    expect(result.mediaId).toBe(COVER_MEDIA_ID);
  });

  it("sends set-cover as POST /v1/trips/{id}/cover with the media id", async () => {
    api.setTripCover.mockResolvedValue(
      response(
        makeCoverTrip({
          version: 2,
          coverMediaId: COVER_MEDIA_ID,
          cover: makeTripCover(),
        }),
      ),
    );
    const client = createCoverMediaClient();

    const trip = await client.setCover(COVER_TRIP_ID, COVER_MEDIA_ID);

    expect(api.setTripCover).toHaveBeenCalledWith(COVER_TRIP_ID, { mediaId: COVER_MEDIA_ID });
    expect(trip.cover?.mediaId).toBe(COVER_MEDIA_ID);
  });

  it("clears the cover through the versioned trip PATCH with coverMediaId: null", async () => {
    api.updateTrip.mockResolvedValue(
      response(makeCoverTrip({ version: 5, coverMediaId: null, cover: null })),
    );
    const client = createCoverMediaClient();

    const trip = await client.clearCover(COVER_TRIP_ID, 4);

    expect(api.updateTrip).toHaveBeenCalledWith(COVER_TRIP_ID, {
      version: 4,
      coverMediaId: null,
    });
    expect(trip.cover).toBeNull();
  });

  it("validates the completed media response against the contract", async () => {
    api.completeMediaUpload.mockResolvedValue(response(makeMedia({ status: "processing" })));
    const client = createCoverMediaClient();

    const media = await client.complete(COVER_MEDIA_ID, { size: 1_024 });

    expect(api.completeMediaUpload).toHaveBeenCalledWith(COVER_MEDIA_ID, { size: 1_024 });
    expect(media.status).toBe("processing");
  });

  it("reads pollable media status from GET /v1/media/{id}", async () => {
    api.getMedia.mockResolvedValue(response(makeMediaRead()));
    const client = createCoverMediaClient();

    const media = await client.fetchMedia(COVER_MEDIA_ID, {});

    expect(api.getMedia).toHaveBeenCalledWith(COVER_MEDIA_ID, {});
    expect(media).toMatchObject({ status: "ready", url: makeMediaRead().url });
  });

  it("turns API problem details into ApiError with the server code", async () => {
    const problem = ProblemDetailsSchema.parse({
      type: "https://roamlog.example/problems/version-conflict",
      title: "Version conflict",
      status: 409,
      detail: "The trip was modified by another member.",
      code: "VERSION_CONFLICT",
    });
    api.updateTrip.mockResolvedValue(response(problem, 409));
    const client = createCoverMediaClient();

    await expect(client.clearCover(COVER_TRIP_ID, 2)).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "The trip was modified by another member.",
    });
  });

  it("rejects a response that does not match the contract", async () => {
    api.getMedia.mockResolvedValue(response({ id: "not-a-uuid" }));
    const client = createCoverMediaClient();

    await expect(client.fetchMedia(COVER_MEDIA_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});