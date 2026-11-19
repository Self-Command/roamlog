import {
  MediaReadSchema,
  MediaSchema,
  type Media,
  type MediaMotion,
  type MediaRead,
} from "@roamlog/contracts";

import { iso, nullableIso, presentDate } from "../trips/content-values.js";
import type { MediaMotionRecord, MediaRecord } from "./media-records.js";
import { normalizeMotionMime } from "./media-rules.js";
import type { SignedMediaUrls } from "./media-url.service.js";

export interface MediaVariantView {
  key: string;
  url: string;
  expiresAt: string;
}

/**
 * Signed motion view handed to the presenter. Only the URL crosses this seam;
 * the storage key never reaches a response.
 */
export interface MediaMotionView {
  url: string | null;
}

/**
 * The live motion row of a still, or `null` for an ordinary image.
 *
 * A soft-deleted motion row does not count: `livePhoto` has to flip back to
 * `false` the moment the still is deleted, even before the object is purged.
 */
export function liveMotion(record: MediaRecord): MediaMotionRecord | null {
  const motion = record.motion;
  if (!motion || motion.deletedAt !== null) {
    return null;
  }
  // The database CHECK only allows the two container types; a row that somehow
  // carries another value is dropped rather than breaking the strict response.
  if (!normalizeMotionMime(motion.mimeType)) {
    return null;
  }
  return motion;
}

/**
 * Projects a media row into the `Media` contract.
 *
 * Fields are listed explicitly instead of spreading the database row: the row
 * also carries operator-only columns (`moderatedAt`, `moderatedById`) that the
 * `.strict()` schema must not see, and the motion relation has to become a
 * signed view rather than raw storage coordinates.
 */
export function presentMedia(
  record: MediaRecord,
  variantUrls: Record<string, MediaVariantView> = {},
  motionView: MediaMotionView | null = null,
): Media {
  const storedVariants = jsonObject(record.variants);
  const variants: Record<string, unknown> = { ...storedVariants };
  for (const [name, view] of Object.entries(variantUrls)) {
    variants[name] = view;
  }
  if (record.status === "ready" && Object.keys(variants).length === 0) {
    variants.original = { key: record.key };
  }

  const motion = liveMotion(record);
  return MediaSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    uploaderId: record.uploaderId,
    bucket: record.bucket,
    key: record.key,
    mimeType: record.mimeType,
    size: record.size,
    width: record.width,
    height: record.height,
    blurhash: record.blurhash,
    variants,
    status: record.status,
    error: record.error,
    caption: record.caption,
    date: record.date ? presentDate(record.date) : null,
    location: record.location,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    livePhoto: motion !== null,
    motion: motion
      ? ({
          url: motionView?.url ?? null,
          mimeType: normalizeMotionMime(motion.mimeType) ?? "video/quicktime",
          durationMs: motion.durationMs,
        } satisfies MediaMotion)
      : null,
  });
}

/**
 * Projects a media row into the single-media read model (`GetMediaResponseSchema`).
 *
 * Bucket, object key and the raw variant map are dropped on purpose: storage
 * coordinates must never leave the API. Signed URLs are only present while the
 * asset is `ready`; unprocessed or failed media reports `null` URLs with its real
 * status instead of a placeholder link.
 */
export function presentMediaRead(record: MediaRecord, urls: SignedMediaUrls): MediaRead {
  const { bucket: _bucket, key: _key, variants: _variants, ...rest } = presentMedia(
    record,
    {},
    { url: urls.motionUrl },
  );
  return MediaReadSchema.parse({
    ...rest,
    url: urls.url,
    thumbUrl: urls.thumbUrl,
    expiresAt: urls.expiresAt,
  });
}

export function variantKeys(record: MediaRecord): string[] {
  const stored = jsonObject(record.variants);
  const keys = new Set<string>([record.key]);
  for (const value of Object.values(stored)) {
    if (isRecord(value) && typeof value.key === "string") {
      keys.add(value.key);
    }
  }
  return [...keys];
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}