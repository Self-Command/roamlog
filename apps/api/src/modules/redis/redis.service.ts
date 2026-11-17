import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private lastErrorLogAt = 0;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PinoLoggerService) logger: PinoLoggerService,
  ) {
    const prefix = config.redisPrefix.endsWith(":") ? config.redisPrefix : `${config.redisPrefix}:`;

    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      keyPrefix: prefix,
      connectionName: "roamlog-api",
    });

    this.client.on("error", (error: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLogAt >= 10_000) {
        this.lastErrorLogAt = now;
        logger.warn({ err: error }, "redis.connection_error");
      }
    });
  }

  async ping(): Promise<void> {
    await withTimeout(this.client.ping(), 2_500, "Redis readiness check timed out");
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(key, value);
      return;
    }
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
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
}
