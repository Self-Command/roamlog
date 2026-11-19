import { Module } from "@nestjs/common";

import { SecurityModule } from "./common/security/security.module.js";
import { AppConfigModule } from "./config/app-config.module.js";
import { SanitizeModule } from "./common/services/sanitize.module.js";
import { ActivitiesModule } from "./modules/activities/activities.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { AiModule } from "./modules/ai/ai.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { CommentsModule } from "./modules/comments/comments.module.js";
import { EntriesModule } from "./modules/entries/entries.module.js";
import { ExpensesModule } from "./modules/expenses/expenses.module.js";
import { ExportsModule } from "./modules/exports/exports.module.js";
import { FeatureFlagsModule } from "./modules/feature-flags/feature-flags.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdempotencyModule } from "./modules/idempotency/idempotency.module.js";
import { InvitationsModule } from "./modules/invitations/invitations.module.js";
import { ItineraryModule } from "./modules/itinerary/itinerary.module.js";
import { MediaModule } from "./modules/media/media.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { ObservabilityModule } from "./modules/observability/observability.module.js";
import { PackingModule } from "./modules/packing/packing.module.js";
import { PlacesModule } from "./modules/places/places.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";
import { RedisModule } from "./modules/redis/redis.module.js";
import { SearchModule } from "./modules/search/search.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { ShareLinksModule } from "./modules/share-links/share-links.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { TripsModule } from "./modules/trips/trips.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module.js";

@Module({
  imports: [
    AppConfigModule,
    SecurityModule,
    SanitizeModule,
    ObservabilityModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    IdempotencyModule,
    AuthModule,
    AuditModule,
    ActivitiesModule,
    CommentsModule,
    NotificationsModule,
    RealtimeModule,
    TripsModule,
    AiModule,
    EntriesModule,
    ItineraryModule,
    MediaModule,
    ExpensesModule,
    PackingModule,
    PlacesModule,
    ExportsModule,
    SearchModule,
    ShareLinksModule,
    WorkspacesModule,
    InvitationsModule,
    UsersModule,
    FeatureFlagsModule,
    SettingsModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule {}
