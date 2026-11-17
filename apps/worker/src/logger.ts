import { pino } from "pino";

export interface WorkerLogger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export function createLogger(level = "info"): WorkerLogger {
  const instance = pino({
    level,
    base: {
      service: "roamlog-worker",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return {
    debug: (context, message) => instance.debug(context, message),
    info: (context, message) => instance.info(context, message),
    warn: (context, message) => instance.warn(context, message),
    error: (context, message) => instance.error(context, message),
  };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: String(error),
  };
}
