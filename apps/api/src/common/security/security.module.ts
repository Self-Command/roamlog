import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AppConfigModule } from "../../config/app-config.module.js";
import { ObservabilityModule } from "../../modules/observability/observability.module.js";
import { RedisModule } from "../../modules/redis/redis.module.js";
import { AuthMutationRateLimitGuard } from "./auth-mutation-rate-limit.guard.js";
import { MediaPresignRateLimitGuard } from "./media-presign-rate-limit.guard.js";
import { OriginGuard } from "./origin.guard.js";
import { PublicShareRateLimitGuard } from "./public-share-rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";

@Global()
@Module({
  imports: [AppConfigModule, ObservabilityModule, RedisModule],
  providers: [
    RateLimitService,
    AuthMutationRateLimitGuard,
    PublicShareRateLimitGuard,
    MediaPresignRateLimitGuard,
    OriginGuard,
    {
      provide: APP_GUARD,
      useExisting: OriginGuard,
    },
  ],
  exports: [
    RateLimitService,
    AuthMutationRateLimitGuard,
    PublicShareRateLimitGuard,
    MediaPresignRateLimitGuard,
    OriginGuard,
  ],
})
export class SecurityModule {}
