import { Module } from "@nestjs/common";

import { AppConfigModule } from "./config/app-config.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdempotencyModule } from "./modules/idempotency/idempotency.module.js";
import { ObservabilityModule } from "./modules/observability/observability.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { RedisModule } from "./modules/redis/redis.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    IdempotencyModule,
    AuditModule,
    HealthModule,
  ],
})
export class AppModule {}
