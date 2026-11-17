import { Inject, Injectable } from "@nestjs/common";
import * as Sentry from "@sentry/node";

import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "./pino-logger.service.js";

export interface SentryHttpContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
}

@Injectable()
export class SentryService {
  private enabled = false;

  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(PinoLoggerService) logger: PinoLoggerService,
  ) {
    if (!config.sentryDsn) {
      return;
    }

    try {
      Sentry.init({
        dsn: config.sentryDsn,
        environment: config.nodeEnv,
        tracesSampleRate: config.sentryTracesSampleRate,
        beforeSend(event) {
          if (event.request) {
            delete event.request.cookies;
            delete event.request.data;
          }
          return event;
        },
      });
      this.enabled = true;
    } catch (error) {
      logger.warn({ err: error }, "sentry.initialization_failed");
    }
  }

  captureException(exception: unknown, context: SentryHttpContext): void {
    if (!this.enabled) {
      return;
    }

    Sentry.withScope((scope) => {
      if (context.requestId) {
        scope.setTag("request_id", context.requestId);
      }
      if (context.statusCode !== undefined) {
        scope.setTag("http_status", String(context.statusCode));
      }
      scope.setContext("http", {
        method: context.method,
        path: context.path,
      });
      Sentry.captureException(exception);
    });
  }
}
