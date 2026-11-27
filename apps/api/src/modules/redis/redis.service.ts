import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import {
  createRedisChannelSubscription,
  type RedisChannelFailure,
  type RedisChannelSubscriber,
  type RedisChannelSubscription,
} from "./redis-channel.js";

/**
 * Redis is a cache / rate-limit / quota / idempotency dependency, never a source
 * of truth. The API must stay alive and keep serving when it disappears: in
 * production a closed Redis port killed the process twice with an uncaught
 * `MaxRetriesPerRequestError` (`.audit/authz-override-report.md:215`,
 * `.audit/g3-api-journeys-report.md:59`).
 *
 * Failure policy implemented here (and mirrored by every caller):
 *
 * | Use                        | On Redis failure                          |
 * | -------------------------- | ----------------------------------------- |
 * | cache (places/settings/trip)| fail-open: degraded read, callers go to DB |
 * | rate limit                  | fail-open: `incrementFixedWindow` rejects,  |
 * |                             | callers fall back to process-local windows  |
 * | idempotency                 | fail-open: `tryAcquire` returns "unavailable"|
 * | quota (AI/Geoapify)         | fail-open: counters skip, warn once         |
 * | queue ingress (export jobs) | fail-closed: `client.rpush` rejects, so the  |
 * |                             | API never pretends a job was queued          |
 * | session/2FA                 | untouched, but no Redis failure reaches them |
 *
 * The instance also advertises whether `REDIS_REQUIRED=true` was set: that only
 * hardens **boot** (fail startup instead of serving degraded forever). At
 * runtime Redis stays fail-open — turning it into a hard request dependency is
 * exactly the outage amplification this module exists to prevent.
 */
export const REDIS_MAX_RETRIES_PER_REQUEST = 2;
export const REDIS_CONNECT_TIMEOUT_MS = 3_000;
export const REDIS_MAX_RECONNECT_ATTEMPTS = 10;
export const REDIS_RETRY_BASE_DELAY_MS = 50;
export const REDIS_RETRY_MAX_DELAY_MS = 2_000;
/** Hard ceiling for a single cache command, so a black-holed Redis cannot hang a request. */
export const REDIS_COMMAND_TIMEOUT_MS = 1_000;
/** One warn per identical error per minute (requirement: log throttle). */
export const REDIS_ERROR_LOG_THROTTLE_MS = 60_000;
/**
 * After the fast retry budget is exhausted (10 attempts, ≈14s) the client
 * settles in `end` and ioredis never reconnects on its own. A Redis restart
 * longer than that would otherwise disable this instance's Redis until the next
 * deployment, so a single slow probe re-opens the connection every 30s. It is
 * not a reconnect storm: one attempt, then either `ready` or another `end`.
 */
export const REDIS_REVIVAL_INTERVAL_MS = 30_000;

export type RedisRetryStrategy = (times: number) => number | null;

/**
 * Bounded exponential backoff: 50ms → 2s, then `null` stops reconnecting after
 * {@link REDIS_MAX_RECONNECT_ATTEMPTS} attempts. `null` is what makes the client
 * settle into `end` instead of retrying forever in the background.
 */
export function redisRetryStrategy(times: number): number | null {
  if (times > REDIS_MAX_RECONNECT_ATTEMPTS) {
    return null;
  }
  return Math.min(REDIS_RETRY_BASE_DELAY_MS * 2 ** (times - 1), REDIS_RETRY_MAX_DELAY_MS);
}

/**
 * Long-lived subscriber connections must survive the initial handshake and
 * every later outage. They are dedicated connections and are not used on the
 * request path, so unlike {@link redisRetryStrategy} this one never gives up.
 */
export function redisSubscriberRetryStrategy(times: number): number {
  const exponent = Math.min(Math.max(times - 1, 0), 16);
  return Math.min(REDIS_RETRY_BASE_DELAY_MS * 2 ** exponent, REDIS_RETRY_MAX_DELAY_MS);
}

/** Outcome of a NX acquisition. `unavailable` means "we could not ask Redis". */
export type RedisAcquisition = "acquired" | "taken" | "unavailable";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  /** `REDIS_REQUIRED` — boot-time requirement only (see the class comment). */
  readonly required: boolean;
  private degraded = false;
  private readonly lastWarnAt = new Map<string, number>();
  private readonly channelSubscriptions = new Set<RedisChannelSubscription>();
  private revivalTimer?: NodeJS.Timeout;
  private destroying = false;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {
    const prefix = config.redisPrefix.endsWith(":") ? config.redisPrefix : `${config.redisPrefix}:`;
    // Tests and embedders may omit the key; absent means "not required".
    this.required = config.redisRequired === true;

    this.client = new Redis(config.redisUrl, {
      // Connect eagerly (startup behaviour unchanged) but never throw from the
      // constructor: ioredis reports failures through `error` events.
      lazyConnect: false,
      maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
      // Fail immediately while the connection is down instead of buffering an
      // unbounded offline queue that later explodes as MaxRetriesPerRequestError.
      enableOfflineQueue: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      retryStrategy: redisRetryStrategy,
      keyPrefix: prefix,
      connectionName: "roamlog-api",
    });

    // MUST stay subscribed: an unhandled `error` event kills the process.
    this.client.on("error", (error: Error) => {
      this.noteFailure("connection", error);
    });
    this.client.on("ready", () => {
      this.clearRevival();
      this.markAvailable();
    });
    this.client.on("end", () => {
      // Retry budget exhausted (or the server closed the socket): no more
      // reconnects from ioredis itself. Log once per minute and arm the slow
      // revival probe so a longer outage is not permanent.
      this.noteFailure("connection", new Error("Redis connection ended"));
      this.scheduleRevival();
    });
  }

  /**
   * With `REDIS_REQUIRED=true` the deployment explicitly declares Redis part of
   * its baseline: refuse to boot when it is unreachable. Default (`false`) keeps
   * the old behaviour — the API boots and serves degraded.
   */
  async onModuleInit(): Promise<void> {
    if (!this.required) {
      return;
    }
    try {
      await this.ping();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new Error(
        `Redis is required (REDIS_REQUIRED=true) but unreachable at boot: ${reason}`,
        { cause: error },
      );
    }
  }

  /** True after an operation failed and until a command succeeds again. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Raised (never swallowed) for callers that own a local fallback: readiness,
   * the admin console probe, and `incrementFixedWindow` consumers.
   */
  async ping(): Promise<void> {
    try {
      await withTimeout(this.client.ping(), 2_500, "Redis readiness check timed out");
      this.markAvailable();
    } catch (error) {
      this.noteFailure("ping", error);
      throw error;
    }
  }

  /**
   * Creates a resilient pub/sub subscription owned by this service. The
   * subscriber gets its own connection because a Redis client in subscriber
   * mode cannot execute ordinary commands.
   */
  subscribeChannel(
    channel: string,
    onMessage: (message: string) => void,
    onFailure?: (failure: RedisChannelFailure) => void,
  ): RedisChannelSubscription {
    const subscription = createRedisChannelSubscription({
      channel,
      onMessage,
      createSubscriber: () =>
        this.client.duplicate({
          enableOfflineQueue: true,
          maxRetriesPerRequest: null,
          retryStrategy: redisSubscriberRetryStrategy,
          autoResubscribe: true,
          connectionName: `roamlog-api:subscriber:${channel}`,
        }) as unknown as RedisChannelSubscriber,
      onFailure: (failure) => {
        onFailure?.(failure);
        this.noteFailure(`subscription:${failure.operation}:${channel}`, failure.error);
      },
    });

    const tracked: RedisChannelSubscription = {
      close: async () => {
        this.channelSubscriptions.delete(tracked);
        await subscription.close();
      },
    };
    this.channelSubscriptions.add(tracked);
    return tracked;
  }

  /**
   * Cache read — fail-open. A missing/failed Redis is indistinguishable from a
   * cache miss, so callers read through to PostgreSQL or the upstream provider.
   * Applies to places/settings/trip caches and the AI run store (`null` becomes
   * "plan not found", a clean domain answer, never a 500).
   */
  async get(key: string): Promise<string | null> {
    return this.run<string | null>(() => this.client.get(key), null, "get");
  }

  /** Cache write — fail-open: losing a cache entry only costs a later refetch. */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.run<void>(
      async () => {
        if (ttlSeconds === undefined) {
          await this.client.set(key, value);
          return;
        }
        await this.client.set(key, value, "EX", ttlSeconds);
      },
      undefined,
      "set",
    );
  }

  /** Presence / marker cleanup — fail-open, stale keys expire on their TTL. */
  async delete(key: string): Promise<void> {
    await this.run<void>(async () => {
      await this.client.del(key);
    }, undefined, "delete");
  }

  /**
   * Idempotency lock — fail-open with an explicit third state. Returning
   * `"unavailable"` lets `IdempotencyService` run the operation anyway and warn,
   * instead of reporting a phantom 409 (`taken`) or a 500.
   */
  async tryAcquire(key: string, value: string, ttlSeconds: number): Promise<RedisAcquisition> {
    try {
      const result = await withTimeout(
        this.client.set(key, value, "EX", ttlSeconds, "NX"),
        REDIS_COMMAND_TIMEOUT_MS,
        "Redis idempotency acquisition timed out",
      );
      this.markAvailable();
      return result === "OK" ? "acquired" : "taken";
    } catch (error) {
      this.noteFailure("tryAcquire", error);
      return "unavailable";
    }
  }

  /**
   * Fixed-window counter shared by rate limiting and provider quotas.
   *
   * Deliberately **throws** on failure: every caller owns a failure mode that
   * only it can pick — the rate limiter degrades to a process-local window,
   * quotas fail open. They all wrap the call in `try/catch` + `withTimeout`
   * (`common/security/rate-limit.service.ts`,
   * `places/places-quota.service.ts`, `ai/ai-quota.service.ts`).
   * Fail-open shape decided by the caller; this primitive never guesses.
   */
  async incrementFixedWindow(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    try {
      const count = await this.client.incr(key);
      let remainingTtl = await this.client.ttl(key);
      if (remainingTtl < 0) {
        await this.client.expire(key, ttlSeconds);
        remainingTtl = ttlSeconds;
      }
      this.markAvailable();
      return { count, ttlSeconds: Math.max(1, remainingTtl) };
    } catch (error) {
      this.noteFailure("incrementFixedWindow", error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroying = true;
    this.clearRevival();
    const subscriptions = [...this.channelSubscriptions];
    this.channelSubscriptions.clear();
    await Promise.allSettled(subscriptions.map((subscription) => subscription.close()));

    if (this.client.status === "end") {
      return;
    }

    try {
      if (this.client.status === "ready") {
        await withTimeout(this.client.quit(), 2_000, "Redis shutdown timed out");
      } else {
        this.client.disconnect();
      }
    } catch {
      this.client.disconnect();
    }
  }

  private async run<T>(operation: () => Promise<T>, fallback: T, name: string): Promise<T> {
    try {
      const result = await withTimeout(
        operation(),
        REDIS_COMMAND_TIMEOUT_MS,
        `Redis ${name} timed out`,
      );
      this.markAvailable();
      return result;
    } catch (error) {
      this.noteFailure(name, error);
      return fallback;
    }
  }

  /**
   * Long-outage recovery. ioredis gives up permanently after `retryStrategy`
   * returns `null`, so once every {@link REDIS_REVIVAL_INTERVAL_MS} we make a
   * single connection attempt. `unref()` keeps the timer from holding the
   * process open, and a failed attempt re-arms through this same path.
   */
  private scheduleRevival(): void {
    if (this.destroying || this.revivalTimer) {
      return;
    }
    const timer = setTimeout(() => {
      this.revivalTimer = undefined;
      if (this.destroying || this.client.status !== "end") {
        return;
      }
      void this.client.connect().catch(() => {
        // Still down: ioredis lands in `end` again, so the next probe is armed
        // here as well as by the `end` listener.
        this.scheduleRevival();
      });
    }, REDIS_REVIVAL_INTERVAL_MS);
    timer.unref?.();
    this.revivalTimer = timer;
  }

  private clearRevival(): void {
    if (!this.revivalTimer) {
      return;
    }
    clearTimeout(this.revivalTimer);
    this.revivalTimer = undefined;
  }

  private markAvailable(): void {
    if (!this.degraded) {
      return;
    }
    this.degraded = false;
    this.logger.warn({ status: this.client.status }, "redis.recovered");
  }

  private noteFailure(operation: string, error: unknown): void {
    this.degraded = true;
    const name = error instanceof Error ? error.name : "UnknownError";
    const signature = `${operation}:${name}`;
    const now = Date.now();
    const last = this.lastWarnAt.get(signature) ?? 0;
    if (now - last < REDIS_ERROR_LOG_THROTTLE_MS) {
      return;
    }
    this.lastWarnAt.set(signature, now);
    if (this.lastWarnAt.size > 50) {
      for (const [key, at] of this.lastWarnAt) {
        if (now - at >= REDIS_ERROR_LOG_THROTTLE_MS) {
          this.lastWarnAt.delete(key);
        }
      }
    }
    this.logger.warn(
      {
        err: error,
        operation,
        redisStatus: this.client.status,
        degraded: true,
      },
      "redis.unavailable_fail_open",
    );
  }
}
