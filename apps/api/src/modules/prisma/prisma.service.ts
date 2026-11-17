import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient } from "@roamlog/db";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly _client: ReturnType<typeof createPrismaClient>;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {
    this._client = createPrismaClient({
      connectionString: config.databaseUrl,
    });
  }

  get client(): ReturnType<typeof createPrismaClient> {
    return this._client;
  }

  async healthCheck(): Promise<void> {
    await withTimeout(this.client.$queryRaw`SELECT 1`, 2_500, "Database readiness check timed out");
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.$disconnect();
    } catch (error) {
      this.logger.warn({ err: error }, "prisma.disconnect_failed");
    }
  }
}
