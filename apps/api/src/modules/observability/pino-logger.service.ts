import { Inject, Injectable } from "@nestjs/common";
import { pino, type Logger } from "pino";

import { AppConfigService } from "../../config/app-config.service.js";

function contextFromParams(params: readonly unknown[]): string | undefined {
  const last = params.at(-1);
  return typeof last === "string" ? last : undefined;
}

@Injectable()
export class PinoLoggerService {
  readonly logger: Logger;

  constructor(@Inject(AppConfigService) config: AppConfigService) {
    this.logger = pino({
      level: config.logLevel,
      base: {
        service: "roamlog-api",
        environment: config.nodeEnv,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "password",
          "token",
          "secret",
        ],
        censor: "[REDACTED]",
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
    });
  }

  private payload(message: unknown, params: readonly unknown[]): Record<string, unknown> {
    const context = contextFromParams(params);
    if (message instanceof Error) {
      return {
        err: message,
        msg: message.message,
        ...(context ? { context } : {}),
      };
    }
    if (typeof message === "object" && message !== null) {
      return {
        ...(message as Record<string, unknown>),
        ...(context && !("msg" in message) ? { msg: context } : {}),
      };
    }
    return {
      msg: String(message),
      ...(context ? { context } : {}),
    };
  }

  log(message: unknown, ...params: unknown[]): void {
    this.logger.info(this.payload(message, params));
  }

  error(message: unknown, ...params: unknown[]): void {
    this.logger.error(this.payload(message, params));
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.logger.warn(this.payload(message, params));
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.logger.debug(this.payload(message, params));
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.logger.trace(this.payload(message, params));
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.logger.fatal(this.payload(message, params));
  }
}
