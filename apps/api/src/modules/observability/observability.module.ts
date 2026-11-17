import { Global, Module } from "@nestjs/common";

import { MetricsController } from "./metrics.controller.js";
import { MetricsService } from "./metrics.service.js";
import { PinoLoggerService } from "./pino-logger.service.js";
import { SentryService } from "./sentry.service.js";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [PinoLoggerService, MetricsService, SentryService],
  exports: [PinoLoggerService, MetricsService, SentryService],
})
export class ObservabilityModule {}
