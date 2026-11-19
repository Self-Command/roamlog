import { performance } from "node:perf_hooks";

import { Inject, Injectable } from "@nestjs/common";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { MetricsService } from "../observability/metrics.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { StorageService } from "../storage/storage.service.js";

export type DependencyStatus = "up" | "down";

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number;
}

export interface ReadinessResult {
  /**
   * - `ok`          all dependencies up
   * - `degraded`    only Redis is down: cache/rate-limit/quota/idempotency lose
   *                 their shared backend, but the API still serves traffic
   * - `unavailable` database or object storage down: the instance cannot serve
   */
  status: "ok" | "degraded" | "unavailable";
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
    storage: DependencyCheck;
  };
}

const READINESS_TIMEOUT_MS = 2_500;

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  private async probe(
    dependency: keyof ReadinessResult["checks"],
    operation: Promise<unknown>,
  ): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await withTimeout(operation, READINESS_TIMEOUT_MS, `${dependency} readiness check timed out`);
      this.metrics.setDependencyHealth(dependency, true);
      return {
        status: "up",
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      this.logger.warn({ err: error, dependency }, "readiness.dependency_unavailable");
      this.metrics.setDependencyHealth(dependency, false);
      return {
        status: "down",
        latencyMs: Math.round(performance.now() - startedAt),
        // No error text: `DependencyHealthSchema` is strict, and provider error
        // messages must not leak through an unauthenticated endpoint.
      };
    }
  }

  async check(): Promise<ReadinessResult> {
    const [database, redis, storage] = await Promise.all([
      this.probe("database", this.prisma.healthCheck()),
      this.probe("redis", this.redis.ping()),
      this.probe("storage", this.storage.checkHealth()),
    ]);

    // Redis is a cache/rate-limit/quota dependency, not a source of truth:
    // losing it degrades the instance but must keep it in the load balancer.
    // Database and object storage are hard dependencies, so they stay 503.
    const hardDependencyDown = database.status === "down" || storage.status === "down";
    const status: ReadinessResult["status"] = hardDependencyDown
      ? "unavailable"
      : redis.status === "up"
        ? "ok"
        : "degraded";

    return {
      status,
      checks: {
        database,
        redis,
        storage,
      },
    };
  }
}
