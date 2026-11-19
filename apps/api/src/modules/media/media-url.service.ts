import { Inject, Injectable, Optional } from "@nestjs/common";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
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
  /**
   * Bucket the object was written to. Empty/absent marks a row created before
   * the bucket column was populated: signing falls back to the current bucket
   * and emits one throttled `media.bucket_missing` warning.
   */
  bucket?: string | null;
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

/** At most one `media.bucket_missing` warning per process per window. */
const BUCKET_MISSING_WARN_INTERVAL_MS = 60_000;

/** Which bucket a row's objects are signed against; `null` means "current". */
interface BucketPlan {
  readonly bucket: string | null;
  readonly displayKey: string;
  readonly thumbKey: string;
}

/**
 * Signs display URLs for media reads.
 *
 * Reuses {@link StorageService} (the project's single S3 client + signed-URL
 * configuration) instead of creating another presigner. Every row is signed
 * against **its own** `bucket`, so changing the configured storage bucket in
 * the admin UI keeps old objects reachable; only rows without a recorded bucket
 * fall back to the current configuration. The result deliberately carries no
 * bucket, object key or raw variant map: storage coordinates must not leak
 * through API responses.
 */
@Injectable()
export class MediaUrlService {
  private lastMissingBucketWarningAt = 0;
  private missingBucketCount = 0;

  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Optional() @Inject(PinoLoggerService) private readonly logger?: PinoLoggerService,
  ) {}

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
    const plans = new Map<string, BucketPlan>();
    const motionPlans = new Map<string, { bucket: string | null; key: string }>();
    const requested = new Map<string, { bucket: string | null; key: string }>();
    for (const record of records) {
      const hasStill = record.status === READY_STATUS && Boolean(record.key);
      const motionKey = liveMotionKey(record.motion);
      // Only resolve (and possibly warn about) the bucket for rows that will
      // actually be signed: an unprocessed row must not produce a warning.
      const bucket = hasStill || motionKey ? this.bucketFor(record) : null;
      if (hasStill) {
        const variants = variantKeys(record.variants);
        const displayKey = preferredKey(variants, DISPLAY_VARIANTS) ?? record.key;
        const thumbKey = preferredKey(variants, THUMB_VARIANTS) ?? displayKey;
        plans.set(record.id, { bucket, displayKey, thumbKey });
        requested.set(objectIdentity(bucket, displayKey), { bucket, key: displayKey });
        requested.set(objectIdentity(bucket, thumbKey), { bucket, key: thumbKey });
      }
      if (motionKey) {
        motionPlans.set(record.id, { bucket, key: motionKey });
        requested.set(objectIdentity(bucket, motionKey), { bucket, key: motionKey });
      }
    }

    const signed = new Map<string, Pick<SignedReadUrl, "url" | "expiresAt">>();
    await Promise.all(
      [...requested].map(async ([identity, entry]) => {
        const view = await this.signedReadUrl(entry.key, entry.bucket);
        signed.set(identity, { url: view.url, expiresAt: view.expiresAt });
      }),
    );

    const result = new Map<string, SignedMediaUrls>();
    for (const record of records) {
      const plan = plans.get(record.id);
      const display = plan ? signed.get(objectIdentity(plan.bucket, plan.displayKey)) : undefined;
      const thumb = plan
        ? (signed.get(objectIdentity(plan.bucket, plan.thumbKey)) ?? display)
        : undefined;
      const motionPlan = motionPlans.get(record.id);
      const motion = motionPlan
        ? signed.get(objectIdentity(motionPlan.bucket, motionPlan.key))
        : undefined;

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

  /**
   * Signs an arbitrary set of keys (`original`, `large`, `thumb`, the motion
   * object) for one row, all against that row's bucket.
   *
   * The media presenters need every processed variant, which is more than the
   * display/thumb pair {@link signMany} resolves; routing them through this
   * method keeps the bucket decision in one place.
   */
  async signKeys(
    media: MediaUrlSource,
    keys: readonly string[],
  ): Promise<Map<string, SignedReadUrl>> {
    const unique = [...new Set(keys.filter((key) => key.trim().length > 0))];
    if (unique.length === 0) {
      return new Map();
    }
    const bucket = this.bucketFor(media);
    const signed = await Promise.all(unique.map((key) => this.signedReadUrl(key, bucket)));
    return new Map(signed.map((value) => [value.key, value]));
  }

  private bucketFor(media: MediaUrlSource): string | null {
    const bucket = typeof media.bucket === "string" ? media.bucket.trim() : "";
    if (bucket) {
      return bucket;
    }
    this.noteMissingBucket(media);
    return null;
  }

  private noteMissingBucket(media: MediaUrlSource): void {
    this.missingBucketCount += 1;
    const now = Date.now();
    if (now - this.lastMissingBucketWarningAt < BUCKET_MISSING_WARN_INTERVAL_MS) {
      return;
    }
    this.lastMissingBucketWarningAt = now;
    const count = this.missingBucketCount;
    this.missingBucketCount = 0;
    this.logger?.warn(
      { code: "MEDIA_BUCKET_MISSING", count, sampleMediaId: media.id },
      "media.bucket_missing",
    );
  }

  private async signedReadUrl(key: string, bucket: string | null): Promise<SignedReadUrl> {
    assertSafeMediaKey(key);
    // `bucket === null` lets StorageService use the *current* bucket, which is
    // both the legacy-row fallback and the historical signature behaviour.
    return bucket === null
      ? this.storage.createSignedReadUrl(key)
      : this.storage.createSignedReadUrl(key, undefined, bucket);
  }
}

/** Identity of one object: the same key in two buckets is two signatures. */
function objectIdentity(bucket: string | null, key: string): string {
  return `${bucket ?? "\u0000current"}\u0000${key}`;
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