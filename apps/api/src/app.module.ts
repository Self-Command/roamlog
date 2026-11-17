import { Module } from "@nestjs/common";

import { AppConfigModule } from "./config/app-config.module.js";
import { SanitizeModule } from "./common/services/sanitize.module.js";
import { ActivitiesModule } from "./modules/activities/activities.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { EntriesModule } from "./modules/entries/entries.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdempotencyModule } from "./modules/idempotency/idempotency.module.js";
import { InvitationsModule } from "./modules/invitations/invitations.module.js";
import { ItineraryModule } from "./modules/itinerary/itinerary.module.js";
import { ObservabilityModule } from "./modules/observability/observability.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { RedisModule } from "./modules/redis/redis.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { TripsModule } from "./modules/trips/trips.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module.js";

@Module({
  imports: [
    AppConfigModule,
    SanitizeModule,
    ObservabilityModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    IdempotencyModule,
    AuthModule,
    AuditModule,
    ActivitiesModule,
    TripsModule,
    EntriesModule,
    ItineraryModule,
    WorkspacesModule,
    InvitationsModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
