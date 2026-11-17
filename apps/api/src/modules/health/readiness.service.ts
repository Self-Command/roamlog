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
  error?: string;
}

export interface ReadinessResult {
  status: "ok" | "unavailable";
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
        error: "dependency check failed",
      };
    }
  }

  async check(): Promise<ReadinessResult> {
    const [database, redis, storage] = await Promise.all([
      this.probe("database", this.prisma.healthCheck()),
      this.probe("redis", this.redis.ping()),
      this.probe("storage", this.storage.checkHealth()),
    ]);

    const ready = database.status === "up" && redis.status === "up" && storage.status === "up";

    return {
      status: ready ? "ok" : "unavailable",
      checks: {
        database,
        redis,
        storage,
      },
    };
  }
}
