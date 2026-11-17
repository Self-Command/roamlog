import { createHash } from "node:crypto";

import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { RedisService } from "../redis/redis.service.js";

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const PENDING = "__ROAMLOG_IDEMPOTENCY_PENDING__";

@Injectable()
export class IdempotencyService {
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

    const acquired = await this.redis.setIfAbsent(redisKey, PENDING, IDEMPOTENCY_TTL_SECONDS);
    if (!acquired) {
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
      await this.redis.set(redisKey, serialized, IDEMPOTENCY_TTL_SECONDS);
      return result;
    } catch (error) {
      await this.redis.delete(redisKey);
      throw error;
    }
  }
}
