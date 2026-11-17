import { Inject, Injectable } from "@nestjs/common";
import { AdminSystemSchema, type AdminSystem } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { StorageService } from "../storage/storage.service.js";
import { AdminQueueService, type AdminQueueCounters } from "./admin-queue.service.js";

type CheckStatus = "up" | "down";

interface CheckResult {
  status: CheckStatus;
  latencyMs: number | null;
}

function environment(): "development" | "test" | "staging" | "production" {
  const value = process.env.NODE_ENV;
  return value === "test" || value === "production" ? value : "development";
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
    const [database, redis, storage, queues] = await Promise.all([
      this.probe(() => this.prisma.healthCheck()),
      this.probe(() => this.redis.ping()),
      this.probe(() => this.storage.checkHealth()),
      this.queue.stats().catch((): AdminQueueCounters[] => []),
    ]);

    return AdminSystemSchema.parse({
      version: process.env.npm_package_version ?? "0.0.0",
      environment: environment(),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
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
      })),
    });
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
