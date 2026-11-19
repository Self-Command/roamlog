import { Inject, Injectable } from "@nestjs/common";

import type { SignedReadUrl } from "../storage/storage.service.js";
import { StorageService } from "../storage/storage.service.js";
import { jsonObject } from "./media.presenter.js";
import { assertSafeMediaKey } from "./media-rules.js";

/** Minimal motion row shape required to sign the paired video URL. */
export interface MediaUrlMotionSource {
  storageKey: string;
  mimeType: string;
  durationMs: number | null;
  deletedAt: Date | null;
}

/** Minimal media row shape required to sign read URLs. */
export interface MediaUrlSource {
  id: string;
  key: string;
  status: string;
  variants: unknown;
  motion?: MediaUrlMotionSource | null;
}

export interface SignedMediaUrls {
  /** Signed display URL, preferring the `large` variant. */
  url: string | null;
  /** Signed thumbnail URL, preferring the `thumb` variant. */
  thumbUrl: string | null;
  /**
   * Signed playback URL of the paired motion asset; `null` when the still has no
   * live motion row. Signed independently of the still's processing status: the
   * motion object is complete as soon as its own upload callback succeeded.
   */
  motionUrl: string | null;
  /** Earliest expiry across the URLs above; `null` when nothing was signed. */
  expiresAt: string | null;
}

const NO_URLS: SignedMediaUrls = { url: null, thumbUrl: null, motionUrl: null, expiresAt: null };

const DISPLAY_VARIANTS = ["large", "original"] as const;
const THUMB_VARIANTS = ["thumb", "large", "original"] as const;
const READY_STATUS = "ready";

/**
 * Signs display URLs for media reads.
 *
 * Reuses {@link StorageService} (the project's single S3 client + signed-URL
 * configuration) instead of creating another presigner. The result deliberately
 * carries no bucket, object key or raw variant map: storage coordinates must not
 * leak through API responses.
 */
@Injectable()
export class MediaUrlService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /**
   * Signed read URLs for one media row.
   *
   * Rows that are not `ready`, or that have no usable object key, yield
   * `{url: null, thumbUrl: null, expiresAt: null}` rather than a placeholder URL.
   * Signing failures propagate — a broken storage configuration must surface as
   * an error, not as "this media has no image".
   */
  async sign(media: MediaUrlSource): Promise<SignedMediaUrls> {
    const signed = await this.signMany([media]);
    return signed.get(media.id) ?? NO_URLS;
  }

  /**
   * Batch variant of {@link sign}. Object keys are deduplicated across the whole
   * batch, so the same media appearing both in a trip gallery and in an entry is
   * signed once.
   */
  async signMany(records: readonly MediaUrlSource[]): Promise<Map<string, SignedMediaUrls>> {
    const plans = new Map<string, { displayKey: string; thumbKey: string }>();
    const motionPlans = new Map<string, string>();
    const requestedKeys = new Set<string>();
    for (const record of records) {
      if (record.status === READY_STATUS && record.key) {
        const variants = variantKeys(record.variants);
        const displayKey = preferredKey(variants, DISPLAY_VARIANTS) ?? record.key;
        const thumbKey = preferredKey(variants, THUMB_VARIANTS) ?? displayKey;
        plans.set(record.id, { displayKey, thumbKey });
        requestedKeys.add(displayKey);
        requestedKeys.add(thumbKey);
      }
      const motionKey = liveMotionKey(record.motion);
      if (motionKey) {
        motionPlans.set(record.id, motionKey);
        requestedKeys.add(motionKey);
      }
    }

    const signed = new Map<string, Pick<SignedReadUrl, "url" | "expiresAt">>();
    await Promise.all(
      [...requestedKeys].map(async (key) => {
        const view = await this.signedReadUrl(key);
        signed.set(key, { url: view.url, expiresAt: view.expiresAt });
      }),
    );

    const result = new Map<string, SignedMediaUrls>();
    for (const record of records) {
      const plan = plans.get(record.id);
      const display = plan ? signed.get(plan.displayKey) : undefined;
      const thumb = plan ? (signed.get(plan.thumbKey) ?? display) : undefined;
      const motionKey = motionPlans.get(record.id);
      const motion = motionKey ? signed.get(motionKey) : undefined;

      const url = display?.url ?? null;
      const thumbUrl = thumb?.url ?? null;
      const motionUrl = motion?.url ?? null;
      if (url === null && thumbUrl === null && motionUrl === null) {
        result.set(record.id, NO_URLS);
        continue;
      }
      result.set(record.id, {
        url,
        thumbUrl,
        motionUrl,
        expiresAt: earliest(
          ...[display?.expiresAt, thumb?.expiresAt, motion?.expiresAt].filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      });
    }
    return result;
  }

  private async signedReadUrl(key: string): Promise<SignedReadUrl> {
    assertSafeMediaKey(key);
    return this.storage.createSignedReadUrl(key);
  }
}

function liveMotionKey(motion: MediaUrlMotionSource | null | undefined): string | null {
  if (!motion || motion.deletedAt !== null) {
    return null;
  }
  return motion.storageKey.trim() ? motion.storageKey : null;
}

function variantKeys(value: unknown): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [name, variant] of Object.entries(jsonObject(value))) {
    const key = jsonObject(variant).key;
    if (typeof key === "string" && key.length > 0) {
      keys.set(name, key);
    }
  }
  return keys;
}

function preferredKey(
  variants: Map<string, string>,
  order: readonly string[],
): string | undefined {
  for (const name of order) {
    const key = variants.get(name);
    if (key) {
      return key;
    }
  }
  return undefined;
}

/** Earliest of the signed expiries; `null` when no URL was signed at all. */
function earliest(...expiries: readonly string[]): string | null {
  let result: string | null = null;
  for (const expiry of expiries) {
    if (result === null || Date.parse(expiry) < Date.parse(result)) {
      result = expiry;
    }
  }
  return result;
}