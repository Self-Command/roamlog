/**
 * Effective upload ceilings and the per-account presign allowance.
 *
 * Two jobs, one owner:
 *
 * 1. `resolve()` turns the `limits.*` runtime into the four numbers the media
 *    endpoints expose and enforce (`GET /media/limits` answers this shape
 *    verbatim). It is read on every request, never cached, so an operator edit
 *    in the admin console changes the accepted range on the next call.
 * 2. `consume()` charges *presigned links* — not HTTP requests — against
 *    `limits.uploadPerMinute`, counted per account. A batch of N files charges N,
 *    so "20 links per account per minute" holds whether the client sends one
 *    request at a time or a single batch.
 *
 * The counter lives in Redis (`rate-limit:mediaUpload:<sha256(userId)>`), the
 * same fixed-window primitive `RateLimitService` uses; a Redis outage degrades to
 * a process-local window and says so through `degraded`, exactly like the auth
 * and public-share limiters.
 *
 * Why the raw `RedisService.client` instead of `incrementFixedWindow`: that
 * primitive increments by exactly one, and charging a 20-file batch one token at
 * a time would cost twenty round trips per request. `RedisService` lives in a
 * module this task must not edit, so the `INCRBY` sequence is written here with
 * the same `ttl < 0 → expire` repair and the same caller-owned fail-open policy.
 */

import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";
import {
  DEFAULT_SEARCH_PER_MINUTE,
  DEFAULT_UPLOAD_MAX_BATCH_BYTES,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  DEFAULT_UPLOAD_MAX_FILES_PER_BATCH,
  DEFAULT_UPLOAD_PER_MINUTE,
  LIMITS_SETTINGS,
  type LimitsRuntime,
  type LimitsSettingsSource,
} from "../settings/limits-settings.consumer.js";

/** `MediaUploadLimitsSchema` fields, so a controller can return this verbatim. */
export interface EffectiveMediaUploadLimits {
  readonly maxFilesPerBatch: number;
  readonly maxFileBytes: number;
  readonly maxBatchBytes: number;
  readonly presignPerMinute: number;
}

export interface MediaUploadAllowance {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  /** True when the answer came from the process-local fallback counter. */
  readonly degraded: boolean;
}

/** The code defaults, used only when no `limits` source is wired at all. */
export const DEFAULT_LIMITS_RUNTIME: LimitsRuntime = Object.freeze({
  searchPerMinute: DEFAULT_SEARCH_PER_MINUTE,
  uploadPerMinute: DEFAULT_UPLOAD_PER_MINUTE,
  uploadMaxFilesPerBatch: DEFAULT_UPLOAD_MAX_FILES_PER_BATCH,
  uploadMaxFileBytes: DEFAULT_UPLOAD_MAX_FILE_BYTES,
  uploadMaxBatchBytes: DEFAULT_UPLOAD_MAX_BATCH_BYTES,
});

/**
 * Maps one `LimitsRuntime` onto the public contract shape.
 *
 * Every field is re-validated: a resolver that hands back `undefined`/`NaN` (a
 * stored row the consumer could not parse, a broken settings read) must not
 * become `NaN` in a response header or in a `count <= limit` comparison. Bad
 * fields fall back to the code defaults instead.
 */
export function toEffectiveUploadLimits(runtime: LimitsRuntime): EffectiveMediaUploadLimits {
  return {
    maxFilesPerBatch: finitePositiveOr(
      runtime.uploadMaxFilesPerBatch,
      DEFAULT_LIMITS_RUNTIME.uploadMaxFilesPerBatch,
    ),
    maxFileBytes: finitePositiveOr(
      runtime.uploadMaxFileBytes,
      DEFAULT_LIMITS_RUNTIME.uploadMaxFileBytes,
    ),
    maxBatchBytes: finitePositiveOr(
      runtime.uploadMaxBatchBytes,
      DEFAULT_LIMITS_RUNTIME.uploadMaxBatchBytes,
    ),
    presignPerMinute: finitePositiveOr(
      runtime.uploadPerMinute,
      DEFAULT_LIMITS_RUNTIME.uploadPerMinute,
    ),
  };
}

/** Distinct namespace from the env-based `rate-limit:mediaPresign` bucket. */
const RATE_LIMIT_KEY_PREFIX = "rate-limit:mediaUpload:";
const COUNTER_TIMEOUT_MS = 750;
const WARN_THROTTLE_MS = 10_000;

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

@Injectable()
export class MediaUploadLimitsService {
  private readonly memoryCounters = new Map<string, MemoryCounter>();
  private lastWarnAt = 0;

  constructor(
    @Inject(LIMITS_SETTINGS) private readonly limits: LimitsSettingsSource,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async resolve(): Promise<EffectiveMediaUploadLimits> {
    return toEffectiveUploadLimits(await this.limits.resolve());
  }

  /**
   * Charges `tokens` presigned links to `identity` (the account id).
   *
   * All-or-nothing: a batch whose N links would cross the allowance is refused
   * whole, because the alternative — issuing a truncated batch — would silently
   * drop photos the user selected.
   *
   * Fail-safe, not fail-429: every number that reaches `decision()` is checked
   * first. A proxy, a client-version skew or an ACL-denied `INCRBY` can answer a
   * non-integer (a local Redis stub answering `"OK"` is exactly that shape), and
   * comparing `"OK" <= 20` would be `false` forever: every upload for the account
   * would stay 429 with `RateLimit-Remaining: NaN`. Non-finite counters therefore
   * throw, land in the `catch` below, and degrade to the process-local window.
   */
  async consume(
    identity: string,
    tokens: number,
    limit: number,
  ): Promise<MediaUploadAllowance> {
    const safeLimit = finitePositiveOr(limit, DEFAULT_LIMITS_RUNTIME.uploadPerMinute);
    const charge = Math.max(1, Math.trunc(Number.isFinite(tokens) ? tokens : 1));
    const windowSeconds = this.windowSecondsOr(60);
    const key = `${RATE_LIMIT_KEY_PREFIX}${sha256(identity)}`;

    try {
      const counter = await withTimeout(
        this.countInRedis(key, charge, windowSeconds),
        COUNTER_TIMEOUT_MS,
        "Media upload rate-limit counter timed out",
      );
      return this.decision(counter.count, counter.ttlSeconds, safeLimit, false);
    } catch (error) {
      this.warn("media.upload_rate_limit_redis_fallback", error);
    }

    const counter = this.countInMemory(key, charge, windowSeconds);
    return this.decision(
      counter.count,
      Math.max(1, Math.ceil((counter.expiresAt - Date.now()) / 1_000)),
      safeLimit,
      true,
    );
  }

  private async countInRedis(
    key: string,
    charge: number,
    windowSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    const client = this.redis.client;
    // Throws (→ in-memory fallback) rather than letting a bad answer poison every
    // later comparison for this account.
    const count = requireFiniteCounter(await client.incrby(key, charge), "INCRBY");
    const rawTtl = await client.ttl(key);
    let remainingTtl = Number.isFinite(rawTtl) ? rawTtl : -1;
    if (remainingTtl < 0) {
      await client.expire(key, windowSeconds);
      remainingTtl = windowSeconds;
    }
    return { count, ttlSeconds: Math.max(1, remainingTtl) };
  }

  private windowSecondsOr(fallback: number): number {
    return finitePositiveOr(this.config.rateLimitWindowSeconds, fallback);
  }

  private countInMemory(key: string, charge: number, windowSeconds: number): MemoryCounter {
    const now = Date.now();
    const current = this.memoryCounters.get(key);
    if (!current || current.expiresAt <= now) {
      const next = { count: charge, expiresAt: now + windowSeconds * 1_000 };
      this.memoryCounters.set(key, next);
      return next;
    }
    current.count += charge;
    return current;
  }

  private decision(
    count: number,
    ttlSeconds: number,
    limit: number,
    degraded: boolean,
  ): MediaUploadAllowance {
    // Both inputs are validated upstream; the guard keeps a future caller from
    // publishing `NaN` through a response header.
    const safeCount = Number.isFinite(count) ? count : Number.POSITIVE_INFINITY;
    const safeLimit = finitePositiveOr(limit, DEFAULT_LIMITS_RUNTIME.uploadPerMinute);
    return {
      allowed: safeCount <= safeLimit,
      limit: safeLimit,
      remaining: Math.max(0, safeLimit - safeCount),
      retryAfterSeconds: Number.isFinite(ttlSeconds) ? Math.max(1, ttlSeconds) : 60,
      degraded,
    };
  }

  private warn(event: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      { event, reason: error instanceof Error ? error.name : "unknown" },
      event,
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A finite, positive integer, else `fallback` (settings can be malformed). */
function finitePositiveOr(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const whole = Math.trunc(value);
  return whole > 0 ? whole : fallback;
}

/**
 * A Redis counter must arrive as a finite number. Anything else is an environment
 * fault (proxy, stub, client skew, ACL refusal) and must send the caller down its
 * documented fallback instead of poisoning every comparison with `NaN`.
 */
function requireFiniteCounter(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `media upload rate-limit ${what} returned ${typeof value}: ${String(value)}`,
    );
  }
  return value;
}
