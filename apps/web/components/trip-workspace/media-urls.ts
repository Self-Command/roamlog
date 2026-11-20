import type { Media } from "@roamlog/contracts";

/**
 * Signed preview URL for a media row.
 *
 * `GET /v1/trips/{id}/media` is typed as `MediaPage` (`MediaSchema`), which has
 * no `url` field — the single-media read (`GET /v1/media/{id}` → `MediaRead`) is
 * the contract's only documented URL carrier. The API implementation currently
 * earns its gallery by attaching signed URLs to `variants` for the list
 * (`apps/api/src/modules/media/media.presenter.ts`). Both shapes are accepted
 * here, in that order of preference, and a row with neither is rendered as its
 * real status — never as a gradient or a placeholder image.
 */
type MediaWithMaybeUrls = Media & { url?: unknown; thumbUrl?: unknown };

const VARIANT_ORDER = ["thumb", "small", "medium", "large", "original"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function mediaPreviewUrl(media: MediaWithMaybeUrls): string | null {
  const direct = nonEmptyString(media.thumbUrl) ?? nonEmptyString(media.url);
  if (direct) return direct;

  if (!isRecord(media.variants)) return null;
  for (const name of VARIANT_ORDER) {
    const variant = media.variants[name];
    if (isRecord(variant)) {
      const url = nonEmptyString(variant.url);
      if (url) return url;
    }
  }
  return null;
}

/**
 * Largest signed URL available for the full-screen viewer.
 *
 * `mediaPreviewUrl` deliberately prefers the 320px `thumb` so the grid stays
 * light; the lightbox needs the opposite order, otherwise zooming a photo shows
 * a blurry upscale. Same source object, same expiry — no second signing path.
 */
const VIEWER_VARIANT_ORDER = ["display", "large", "medium", "original", "small", "thumb"] as const;

export function mediaViewerUrl(media: MediaWithMaybeUrls): string | null {
  const direct = nonEmptyString(media.url);
  if (direct) return direct;

  if (isRecord(media.variants)) {
    for (const name of VIEWER_VARIANT_ORDER) {
      const variant = media.variants[name];
      if (isRecord(variant)) {
        const url = nonEmptyString(variant.url);
        if (url) return url;
      }
    }
  }
  return mediaPreviewUrl(media);
}

/** Group key for the photo grid: the photo's own date, else its upload date. */
export function mediaGroupKey(media: Media): string {
  if (media.date) return media.date;
  return media.createdAt.slice(0, 10);
}