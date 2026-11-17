import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { ProblemDetailsFilter } from "../common/filters/problem-details.filter.js";
import { createRequestIdMiddleware } from "../common/middleware/request-id.middleware.js";
import { AppConfigService } from "../config/app-config.service.js";
import { createHttpLogger } from "../modules/observability/http-logger.middleware.js";
import { MetricsService } from "../modules/observability/metrics.service.js";
import { PinoLoggerService } from "../modules/observability/pino-logger.service.js";
import { requestMetricsMiddleware } from "../modules/observability/request-metrics.middleware.js";
import { SentryService } from "../modules/observability/sentry.service.js";

export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const logger = app.get(PinoLoggerService);
  const metrics = app.get(MetricsService);
  const sentry = app.get(SentryService);
  const express = app.getHttpAdapter().getInstance() as {
    set(setting: string, value: unknown): void;
  };

  app.setGlobalPrefix("v1");
  app.useLogger(logger);
  app.enableShutdownHooks();

  if (config.trustProxy) {
    express.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
      xFrameOptions: { action: "deny" },
      hsts: config.isProduction
        ? {
            maxAge: 31_536_000,
            includeSubDomains: true,
            preload: false,
          }
        : false,
    }),
  );
  app.use(cookieParser(config.betterAuthSecret));
  app.use(createRequestIdMiddleware());
  app.use(createHttpLogger(logger.logger));
  app.use(requestMetricsMiddleware(metrics));

  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, !origin || config.corsOrigins.includes(origin));
    },
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });

  app.useGlobalFilters(new ProblemDetailsFilter(logger, sentry));
}
