"use client";

import {
  CompleteMediaMotionRequestSchema,
  GetMediaResponseSchema,
  MediaMotionPresignRequestSchema,
  MediaMotionPresignResponseSchema,
  type CompleteMediaMotionRequest,
  type CompleteMediaRequest,
  type Media,
  type MediaMotionPresignRequest,
  type MediaMotionPresignResponse,
  type MediaPresignRequest,
  type MediaPresignResponse,
  type MediaRead,
} from "@roamlog/contracts";
import { useCallback, useRef, useState } from "react";

import {
  createCoverMediaClient,
  type CoverMediaClient,
  type PutObjectRequest,
} from "@/lib/api/media";
import {
  IMAGE_MAX_EDGE,
  IMAGE_QUALITY_STEPS,
  IMAGE_TARGET_BYTES,
  toWebpFileName,
  type CompressionResult,
} from "@/lib/image/compress-image";
import { compressImage } from "@/lib/image/use-image-compression";
import {
  readPhotoExif,
  readPhotoExifSafely,
  type PhotoExifRead,
  type PhotoExifReader,
} from "@/lib/image/read-photo-exif";
import { pairLivePhotos, type LivePhotoPair } from "@/lib/image/live-photo-pair";
import {
  LIVE_PHOTO_MOTION_MAX_BYTES,
  probeMotionDuration,
  validateMotionFile,
  type MotionValidation,
} from "@/lib/image/live-photo-motion";

/**
 * The network surface this flow needs.
 *
 * The still endpoints reuse the existing D1 pipeline unchanged (`createCoverMediaClient`
 * → presign → PUT → complete). The motion endpoints speak the same authenticated
 * JSON transport and are validated against the contract schemas before they
 * reach the UI, because `@roamlog/api-client` does not know them until the
 * OpenAPI contract is regenerated.
 */
export interface LivePhotoUploadClient {
  presignStill(workspaceId: string, input: MediaPresignRequest): Promise<MediaPresignResponse>;
  putObject(request: PutObjectRequest): Promise<void>;
  completeStill(mediaId: string, input: CompleteMediaRequest): Promise<Media>;
  presignMotion(
    workspaceId: string,
    mediaId: string,
    input: MediaMotionPresignRequest,
  ): Promise<MediaMotionPresignResponse>;
  completeMotion(
    workspaceId: string,
    mediaId: string,
    input: CompleteMediaMotionRequest,
  ): Promise<MediaRead>;
}

async function postJson<T>(
  path: string,
  body: unknown,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = (payload as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `请求失败（HTTP ${response.status}）。`);
  }
  return schema.parse(payload);
}

export function createLivePhotoUploadClient(
  stillClient: CoverMediaClient = createCoverMediaClient(),
): LivePhotoUploadClient {
  return {
    presignStill: (workspaceId, input) => stillClient.presign(workspaceId, input),
    putObject: stillClient.putObject,
    completeStill: (mediaId, input) => stillClient.complete(mediaId, input),

    async presignMotion(workspaceId, mediaId, input) {
      return postJson(
        `/v1/workspaces/${workspaceId}/media/${mediaId}/motion/presign`,
        MediaMotionPresignRequestSchema.parse(input),
        MediaMotionPresignResponseSchema,
      );
    },

    async completeMotion(workspaceId, mediaId, input) {
      return postJson(
        `/v1/workspaces/${workspaceId}/media/${mediaId}/motion`,
        CompleteMediaMotionRequestSchema.parse(input),
        GetMediaResponseSchema,
      );
    },
  };
}

export type LivePhotoUploadPhase = "idle" | "uploading" | "ready" | "error";

export interface LivePhotoUploadItem {
  stillName: string;
  motionName: string;
  /** `true` once the motion callback returned a `livePhoto: true` payload. */
  livePhoto: boolean;
  mediaId: string | null;
  /** Read model of the still after completion (signed URLs, no storage keys). */
  media: Media | null;
  /** Read model with the signed motion URL once a motion was registered. */
  liveMedia: MediaRead | null;
  /** Non-null when the movie was rejected; the still still uploads. */
  motionError: string | null;
  error: string | null;
}

export interface UseLivePhotoUploadOptions {
  workspaceId: string;
  tripId?: string | null;
  client?: LivePhotoUploadClient;
  /** Test seam; defaults to the hidden-`<video>` probe. */
  probeDuration?: (file: File) => Promise<number | null>;
  /** Test seam; defaults to the D1 Worker compression pipeline. */
  compress?: (file: File) => Promise<CompressionResult>;
  /**
   * Test seam for the pre-compression EXIF read of the still. The paired movie
   * is not re-encoded (D2) but is also not read here: the still is the content
   * unit the gallery shows, and its metadata is what the source file carries.
   */
  exifReader?: PhotoExifReader;
  maxMotionBytes?: number;
}

export interface UseLivePhotoUploadResult {
  phase: LivePhotoUploadPhase;
  items: LivePhotoUploadItem[];
  /** Files that did not pair (extra movies, lone stills, unknown files). */
  unpaired: File[];
  error: string | null;
  upload(files: File[]): Promise<void>;
  reset(): void;
}

const STILL_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

/** The presign contract only accepts the six image types, by MIME. */
export function stillMimeType(file: Pick<File, "name" | "type">): string {
  const type = file.type.trim().toLowerCase();
  if (type.startsWith("image/")) return type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return STILL_MIME_BY_EXTENSION[extension] ?? "image/jpeg";
}

/**
 * Uploads Live Photo pairs.
 *
 * The still goes through the untouched D1 pipeline: browser compression →
 * presign → signed PUT → complete. The movie is uploaded **uncompressed** — a
 * browser re-encode would rewrite the `moov` atom and drop Apple's
 * still-image-time metadata — after the size/duration checks. A rejected movie
 * never blocks the still: the photo is uploaded and the readable reason is
 * attached to the item, which is also why `unpaired` is never silently dropped.
 */
export function useLivePhotoUpload(
  options: UseLivePhotoUploadOptions,
): UseLivePhotoUploadResult {
  const { workspaceId, tripId } = options;
  const [phase, setPhase] = useState<LivePhotoUploadPhase>("idle");
  const [items, setItems] = useState<LivePhotoUploadItem[]>([]);
  const [unpaired, setUnpaired] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const defaultClientRef = useRef<LivePhotoUploadClient | null>(null);
  if (!defaultClientRef.current) {
    defaultClientRef.current = createLivePhotoUploadClient();
  }
  const client = options.client ?? defaultClientRef.current;

  const upload = useCallback(
    async (files: File[]) => {
      const pairing = pairLivePhotos(files);
      setUnpaired(pairing.unpaired);
      setItems(
        pairing.pairs.map((pair) => ({
          stillName: pair.still.name,
          motionName: pair.motion.name,
          livePhoto: false,
          mediaId: null,
          media: null,
          liveMedia: null,
          motionError: null,
          error: null,
        })),
      );
      if (pairing.pairs.length === 0) {
        setPhase("ready");
        setError(null);
        return;
      }

      setPhase("uploading");
      setError(null);
      const update = (index: number, patch: Partial<LivePhotoUploadItem>) => {
        setItems((current) =>
          current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
        );
      };

      for (const [index, pair] of pairing.pairs.entries()) {
        try {
          const media = await uploadStill(client, workspaceId, tripId ?? null, pair, options);
          update(index, { mediaId: media.id, media });
          if (!media.id.trim()) {
            update(index, { error: "图片已上传，但暂时无法确认，请重试。" });
            continue;
          }

          const validation = await validateMotion(options, pair);
          if (!validation.ok) {
            update(index, { motionError: validation.error.message });
            continue;
          }

          const withMotion = await uploadMotion(
            client,
            workspaceId,
            media.id,
            pair,
            validation,
          );
          update(index, {
            mediaId: withMotion.id,
            liveMedia: withMotion,
            livePhoto: withMotion.livePhoto === true,
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "上传失败。";
          update(index, { error: message });
          setPhase("error");
          setError(message);
          return;
        }
      }
      setPhase("ready");
    },
    [client, options, tripId, workspaceId],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setItems([]);
    setUnpaired([]);
    setError(null);
  }, []);

  return { phase, items, unpaired, error, upload, reset };
}

async function uploadStill(
  client: LivePhotoUploadClient,
  workspaceId: string,
  tripId: string | null,
  pair: LivePhotoPair,
  options: UseLivePhotoUploadOptions,
): Promise<Media> {
  const compress =
    options.compress ??
    ((file: File) =>
      compressImage(file, {
        maxEdge: IMAGE_MAX_EDGE,
        targetBytes: IMAGE_TARGET_BYTES,
        quality: IMAGE_QUALITY_STEPS[0],
      }));
  // Same rule as the cover uploader: the still's EXIF has to be read from the
  // source file *before* the canvas re-encode, and it travels with the existing
  // completion callback rather than adding a request of its own. Reading first
  // (not in parallel with the encode) also keeps the metadata available when the
  // compression is slow, and lowers the peak memory of a large HEIC.
  const exifReader = options.exifReader ?? readPhotoExif;
  const photoExif = await readPhotoExifSafely(exifReader, pair.still);

  const compressed = await compress(pair.still);
  const uploadBlob = compressed.full;
  const mimeType = compressed.skipped ? stillMimeType(pair.still) : "image/webp";
  const fileName = compressed.skipped ? pair.still.name : toWebpFileName(pair.still.name);

  const presigned = await client.presignStill(workspaceId, {
    ...(tripId ? { tripId } : {}),
    fileName,
    mimeType,
    size: uploadBlob.size,
    ...(compressed.width > 0 ? { width: compressed.width } : {}),
    ...(compressed.height > 0 ? { height: compressed.height } : {}),
  } as MediaPresignRequest);
  await client.putObject({
    url: presigned.uploadUrl,
    headers: presigned.headers,
    file: uploadBlob,
  });
  return client.completeStill(presigned.mediaId, {
    size: uploadBlob.size,
    ...(compressed.width > 0 ? { width: compressed.width } : {}),
    ...(compressed.height > 0 ? { height: compressed.height } : {}),
    ...(compressed.blurhash ? { blurhash: compressed.blurhash } : {}),
    ...completionExif(photoExif),
  });
}

/**
 * Maps the pre-compression EXIF read onto the `complete` request body.
 *
 * `lat`/`lng` are emitted as a pair or not at all: the contract rejects a
 * half-position, and the database CHECK would surface one as a 500.
 */
function completionExif(read: PhotoExifRead | null): {
  exif?: PhotoExifRead["exif"];
  lat?: number;
  lng?: number;
} {
  if (!read) {
    return {};
  }
  return read.lat !== null && read.lng !== null
    ? { exif: read.exif, lat: read.lat, lng: read.lng }
    : { exif: read.exif };
}

async function validateMotion(
  options: UseLivePhotoUploadOptions,
  pair: LivePhotoPair,
): Promise<MotionValidation> {
  const probe = options.probeDuration ?? probeMotionDuration;
  let durationMs: number | null;
  try {
    durationMs = await probe(pair.motion);
  } catch {
    durationMs = null;
  }
  return validateMotionFile(pair.motion, {
    durationMs,
    ...(options.maxMotionBytes ? { maxBytes: options.maxMotionBytes } : {}),
  });
}

async function uploadMotion(
  client: LivePhotoUploadClient,
  workspaceId: string,
  mediaId: string,
  pair: LivePhotoPair,
  validation: Extract<MotionValidation, { ok: true }>,
): Promise<MediaRead> {
  const presigned = await client.presignMotion(workspaceId, mediaId, {
    fileName: pair.motion.name,
    mimeType: validation.mimeType,
    size: pair.motion.size,
    ...(validation.durationMs === null ? {} : { durationMs: validation.durationMs }),
  });
  await client.putObject({
    url: presigned.uploadUrl,
    headers: presigned.headers,
    file: pair.motion,
  });
  return client.completeMotion(workspaceId, mediaId, {
    storageKey: presigned.storageKey,
    mimeType: validation.mimeType,
    sizeBytes: pair.motion.size,
    durationMs: validation.durationMs,
  });
}

export { LIVE_PHOTO_MOTION_MAX_BYTES };
