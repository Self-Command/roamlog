import { pino } from "pino";

import type { GuardLogger } from "../common/process-guards.js";

/**
 * Minimal logger contract used before the Nest application (and therefore
 * `PinoLoggerService`) exists. Once the app is created the bootstrap swaps to
 * the injected Nest logger; both implement {@link GuardLogger}.
 */
export interface StartupLogger extends GuardLogger {
  flush?(callback?: () => void): void;
}

/**
 * Structured JSON on stdout/stderr, matching the service fields of the Nest
 * pino logger closely enough that one pipeline can parse both. Used only for
 * the first stages (`environment`, `modules`, `nest`) and for startup failures
 * that happen before DI is up.
 */
export function createEarlyLogger(): StartupLogger {
  const instance = pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: {
      service: "roamlog-api",
      environment: process.env.NODE_ENV ?? "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });

  return {
    log: (payload, message) => instance.info(payload, message),
    warn: (payload, message) => instance.warn(payload, message),
    error: (payload, message) => instance.error(payload, message),
    fatal: (payload, message) => instance.fatal(payload, message),
    flush: (callback) => {
      instance.flush(callback ?? (() => undefined));
    },
  };
}