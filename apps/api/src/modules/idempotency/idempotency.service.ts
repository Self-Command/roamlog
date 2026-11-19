import { createHash } from "node:crypto";

import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const PENDING = "__ROAMLOG_IDEMPOTENCY_PENDING__";
const REDIS_DEGRADED_WARN_THROTTLE_MS = 60_000;

/**
 * Idempotency keys live in Redis and are **fail-open**.
 *
 * Semantics chosen for a Redis outage:
 * - a read that cannot reach Redis behaves like "no stored result" (operation runs);
 * - an acquisition that cannot reach Redis is `"unavailable"`, so the operation
 *   runs once and a warn is logged — we never invent a `409 IN_PROGRESS` for a
 *   request that is not actually in flight, and never return a 500;
 * - marker cleanup after a failed operation is best-effort, so a Redis failure
 *   cannot mask the original error.
 *
 * The tradeoff is explicit: during an outage a retried request may execute
 * twice. That is preferable to taking those endpoints down (exports, admin
 * operations, AI confirm) for a cache outage, and the duplicate is still
 * guarded by the database's own constraints.
 */
@Injectable()
export class IdempotencyService {
  private lastDegradedWarnAt = 0;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  private redisKey(scope: string, key: string): string {
    if (!scope.trim() || !key.trim()) {
      throw new BadRequestException("Idempotency scope and key are required");
    }
    const digest = createHash("sha256").update(`${scope}\u0000${key}`).digest("hex");
    return `idempotency:${digest}`;
  }

  private async read<T>(redisKey: string): Promise<T | undefined> {
    // `RedisService.get` is fail-open: an outage reads as "nothing stored".
    const stored = await this.redis.get(redisKey);
    if (stored === null) {
      return undefined;
    }
    if (stored === PENDING) {
      throw new ConflictException({
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "A request with this idempotency key is already in progress",
      });
    }

    try {
      return JSON.parse(stored) as T;
    } catch (error) {
      this.logger.error({ err: error }, "idempotency.result_invalid");
      throw new ConflictException({
        code: "IDEMPOTENCY_RESULT_INVALID",
        message: "The stored idempotent response is invalid",
      });
    }
  }

  async get<T>(scope: string, key: string): Promise<T | undefined> {
    return this.read<T>(this.redisKey(scope, key));
  }

  async set<T>(scope: string, key: string, result: T): Promise<void> {
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      throw new BadRequestException("Idempotent results must be JSON serializable");
    }
    await this.redis.set(this.redisKey(scope, key), serialized, IDEMPOTENCY_TTL_SECONDS);
  }

  async run<T>(scope: string, key: string, operation: () => Promise<T>): Promise<T> {
    const redisKey = this.redisKey(scope, key);
    const existing = await this.read<T>(redisKey);
    if (existing !== undefined) {
      return existing;
    }

    const acquisition = await this.redis.tryAcquire(redisKey, PENDING, IDEMPOTENCY_TTL_SECONDS);

    if (acquisition === "unavailable") {
      // Fail-open: Redis cannot tell us whether this key is in flight. Running
      // the operation is safer than a phantom conflict or a 500.
      this.warnDegraded(scope);
      return operation();
    }

    if (acquisition === "taken") {
      const concurrentResult = await this.read<T>(redisKey);
      if (concurrentResult !== undefined) {
        return concurrentResult;
      }
      throw new ConflictException({
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "A request with this idempotency key is already in progress",
      });
    }

    try {
      const result = await operation();
      const serialized = JSON.stringify(result);
      if (serialized === undefined) {
        throw new BadRequestException("Idempotent results must be JSON serializable");
      }
      // Fail-open write: losing the cached result only allows a replay later.
      await this.redis.set(redisKey, serialized, IDEMPOTENCY_TTL_SECONDS);
      return result;
    } catch (error) {
      // Best-effort cleanup; `delete` never throws, so the real error surfaces.
      await this.redis.delete(redisKey);
      throw error;
    }
  }

  private warnDegraded(scope: string): void {
    const now = Date.now();
    if (now - this.lastDegradedWarnAt < REDIS_DEGRADED_WARN_THROTTLE_MS) {
      return;
    }
    this.lastDegradedWarnAt = now;
    this.logger.warn(
      { event: "idempotency.redis_unavailable", policy: "fail-open", scope },
      "idempotency.degraded",
    );
  }
}