import { Inject, Injectable } from "@nestjs/common";
import {
  AdminSystemSchema,
  type AdminSystem,
  type AdminSystemMigration,
  type AdminSystemWorker,
} from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { StorageService } from "../storage/storage.service.js";
import { AdminQueueService, type AdminQueueCounters } from "./admin-queue.service.js";

type CheckStatus = "up" | "down";

interface CheckResult {
  status: CheckStatus;
  latencyMs: number | null;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | string | null;
}

function environment(): "development" | "test" | "staging" | "production" {
  const value = process.env.NODE_ENV;
  return value === "test" || value === "production" ? value : "development";
}

function timestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

@Injectable()
export class AdminSystemService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AdminQueueService) private readonly queue: AdminQueueService,
  ) {}

  async get(): Promise<AdminSystem> {
    const version = process.env.npm_package_version ?? "0.0.0";
    const startedAt = new Date(Date.now() - Math.floor(process.uptime() * 1_000));
    const [database, redis, storage, queues, migration, worker] = await Promise.all([
      this.probe(() => this.prisma.healthCheck()),
      this.probe(() => this.redis.ping()),
      this.probe(() => this.storage.checkHealth()),
      this.queue.stats().catch((): AdminQueueCounters[] => []),
      this.latestMigration(),
      Promise.resolve()
        .then(() => this.queue.workerHealth())
        .catch((): AdminSystemWorker => ({ status: "down", version, consumers: 0 })),
    ]);

    return AdminSystemSchema.parse({
      version,
      environment: environment(),
      nodeVersion: process.version,
      buildTime: timestamp(process.env.ROAMLOG_BUILD_TIME) ?? startedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      migration,
      worker: {
        ...worker,
        version: process.env.ROAMLOG_WORKER_VERSION ?? version,
      },
      checks: {
        database,
        redis,
        storage,
      },
      queues: queues.map((item) => ({
        name: item.name,
        waiting: item.waiting,
        active: item.active,
        failed: item.failed,
        delayed: item.delayed,
        paused: item.paused,
      })),
    });
  }

  private async latestMigration(): Promise<AdminSystemMigration> {
    try {
      const rows = await this.prisma.client.$queryRaw<MigrationRow[]>`
        SELECT migration_name, finished_at
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `;
      const latest = rows[0];
      return {
        version: latest?.migration_name ?? null,
        appliedAt: latest?.finished_at ? new Date(latest.finished_at).toISOString() : null,
      };
    } catch {
      return { version: null, appliedAt: null };
    }
  }

  private async probe(operation: () => Promise<unknown>): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      await operation();
      return { status: "up", latencyMs: Date.now() - startedAt };
    } catch {
      return { status: "down", latencyMs: null };
    }
  }
}
