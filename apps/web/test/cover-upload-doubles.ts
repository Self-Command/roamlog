import type {
  CompleteMediaRequest,
  Media,
  MediaPresignRequest,
  MediaRead,
  Trip,
  TripCover,
} from "@roamlog/contracts";

import type { CoverMediaClient, PutObjectRequest } from "@/lib/api/media";

import { makeTrip } from "./fake-data";

export const COVER_WORKSPACE_ID = "0198f000-0000-7000-8000-0000000000c1";
export const COVER_TRIP_ID = "0198f000-0000-7000-8000-0000000000a1";
export const COVER_MEDIA_ID = "0198f000-0000-7000-8000-0000000000b1";
export const COVER_USER_ID = "0198f000-0000-7000-8000-0000000000d1";
export const COVER_TIMESTAMP = "2026-11-18T12:00:00.000Z";
export const COVER_EXPIRES_AT = "2026-11-18T23:59:59.000Z";

export function makeTripCover(overrides: Partial<TripCover> = {}): TripCover {
  return {
    mediaId: COVER_MEDIA_ID,
    status: "ready",
    url: "https://media.example.test/trips/cover-large.jpg",
    thumbUrl: "https://media.example.test/trips/cover-thumb.jpg",
    width: 1600,
    height: 900,
    blurhash: null,
    expiresAt: COVER_EXPIRES_AT,
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: COVER_MEDIA_ID,
    workspaceId: COVER_WORKSPACE_ID,
    tripId: COVER_TRIP_ID,
    uploaderId: COVER_USER_ID,
    bucket: "roamlog-media",
    key: `${COVER_WORKSPACE_ID}/2026/11/${COVER_MEDIA_ID}/original.jpg`,
    mimeType: "image/jpeg",
    size: 1024,
    width: 1600,
    height: 900,
    blurhash: null,
    variants: {},
    status: "processing",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: COVER_TIMESTAMP,
    updatedAt: COVER_TIMESTAMP,
    deletedAt: null,
    ...overrides,
  };
}

export function makeMediaRead(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: COVER_MEDIA_ID,
    workspaceId: COVER_WORKSPACE_ID,
    tripId: COVER_TRIP_ID,
    uploaderId: COVER_USER_ID,
    mimeType: "image/jpeg",
    size: 1024,
    width: 1600,
    height: 900,
    blurhash: null,
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: COVER_TIMESTAMP,
    updatedAt: COVER_TIMESTAMP,
    deletedAt: null,
    url: "https://media.example.test/media/cover-large.jpg",
    thumbUrl: "https://media.example.test/media/cover-thumb.jpg",
    expiresAt: COVER_EXPIRES_AT,
    ...overrides,
  };
}

export function makeCoverTrip(overrides: Partial<Trip> = {}): Trip {
  return makeTrip({
    id: COVER_TRIP_ID,
    workspaceId: COVER_WORKSPACE_ID,
    version: 1,
    coverMediaId: null,
    cover: null,
    ...overrides,
  });
}

export interface FakeMediaClientCalls {
  presign: MediaPresignRequest[];
  put: PutObjectRequest[];
  complete: Array<{ mediaId: string; input: CompleteMediaRequest }>;
  fetch: string[];
  setCover: Array<{ tripId: string; mediaId: string }>;
  clearCover: Array<{ tripId: string; version: number }>;
}

/**
 * Deterministic media client double. Every default resolves successfully; tests
 * override one step to exercise failures without touching the network.
 */
export function createFakeMediaClient(overrides: Partial<CoverMediaClient> = {}): {
  client: CoverMediaClient;
  calls: FakeMediaClientCalls;
} {
  const calls: FakeMediaClientCalls = {
    presign: [],
    put: [],
    complete: [],
    fetch: [],
    setCover: [],
    clearCover: [],
  };

  const client: CoverMediaClient = {
    async presign(_workspaceId, input) {
      calls.presign.push(input);
      return {
        mediaId: COVER_MEDIA_ID,
        uploadUrl: "https://storage.example.test/presigned-put?X-Amz-Signature=stub",
        method: "PUT",
        headers: { "Content-Type": input.mimeType },
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },
    async putObject(request) {
      calls.put.push(request);
      request.onProgress?.(Math.floor(request.file.size / 2), request.file.size);
      request.onProgress?.(request.file.size, request.file.size);
    },
    async complete(mediaId, input) {
      calls.complete.push({ mediaId, input });
      return makeMedia({ status: "processing" });
    },
    async fetchMedia(mediaId) {
      calls.fetch.push(mediaId);
      return makeMediaRead();
    },
    async setCover(tripId, mediaId) {
      calls.setCover.push({ tripId, mediaId });
      return makeCoverTrip({
        id: tripId,
        version: 2,
        coverMediaId: mediaId,
        cover: makeTripCover({ mediaId }),
      });
    },
    async clearCover(tripId, version) {
      calls.clearCover.push({ tripId, version });
      return makeCoverTrip({ id: tripId, version: version + 1, coverMediaId: null, cover: null });
    },
    ...overrides,
  };

  return { client, calls };
}