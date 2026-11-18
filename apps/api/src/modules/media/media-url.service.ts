import { Inject, Injectable } from "@nestjs/common";

import type { SignedReadUrl } from "../storage/storage.service.js";
import { StorageService } from "../storage/storage.service.js";
import { jsonObject } from "./media.presenter.js";
import { assertSafeMediaKey } from "./media-rules.js";

/** Minimal media row shape required to sign read URLs. */
export interface MediaUrlSource {
  id: string;
  key: string;
  status: string;
  variants: unknown;
}

export interface SignedMediaUrls {
  /** Signed display URL, preferring the `large` variant. */
  url: string | null;
  /** Signed thumbnail URL, preferring the `thumb` variant. */
  thumbUrl: string | null;
  /** Earliest expiry across the URLs above; `null` when nothing was signed. */
  expiresAt: string | null;
}

const NO_URLS: SignedMediaUrls = { url: null, thumbUrl: null, expiresAt: null };

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
    const requestedKeys = new Set<string>();
    for (const record of records) {
      if (record.status !== READY_STATUS || !record.key) {
        continue;
      }
      const variants = variantKeys(record.variants);
      const displayKey = preferredKey(variants, DISPLAY_VARIANTS) ?? record.key;
      const thumbKey = preferredKey(variants, THUMB_VARIANTS) ?? displayKey;
      plans.set(record.id, { displayKey, thumbKey });
      requestedKeys.add(displayKey);
      requestedKeys.add(thumbKey);
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
      if (!plan || !display) {
        result.set(record.id, NO_URLS);
        continue;
      }
      const thumb = signed.get(plan.thumbKey) ?? display;
      result.set(record.id, {
        url: display.url,
        thumbUrl: thumb.url,
        expiresAt: earliest(display.expiresAt, thumb.expiresAt),
      });
    }
    return result;
  }

  private async signedReadUrl(key: string): Promise<SignedReadUrl> {
    assertSafeMediaKey(key);
    return this.storage.createSignedReadUrl(key);
  }
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

function earliest(left: string, right: string): string {
  return Date.parse(right) < Date.parse(left) ? right : left;
}
