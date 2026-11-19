/**
 * Last-resort process guards.
 *
 * `unhandledRejection` is not fatal by itself: one forgotten `await` must not
 * kill an API that is otherwise serving. It is recorded as a structured
 * `fatal` entry and the process is marked `degraded` (count + last summaries),
 * so the miss is visible without dropping traffic.
 *
 * The exception is a runaway: {@link DEFAULT_REJECTION_THRESHOLD} rejections
 * inside {@link DEFAULT_REJECTION_WINDOW_MS} mean the process is failing
 * systematically (a broken loop, a dependency rejecting on every call), which
 * cannot be served safely. Then the guard stops the process through the same
 * graceful shutdown path and exits `1`.
 *
 * `uncaughtException` has already unwound to an unknown state, so it is
 * always fatal: log, teardown, flush, exit `1`.
 *
 * All injectable (`exit`, `now`, `flush`, `onFatal`) so tests assert the
 * decisions without shutting down the test runner.
 */

export const DEFAULT_REJECTION_WINDOW_MS = 60_000;
export const DEFAULT_REJECTION_THRESHOLD = 10;
export const DEFAULT_RECENT_LIMIT = 5;
export const DEFAULT_FLUSH_TIMEOUT_MS = 2_000;
export const DEFAULT_TEARDOWN_TIMEOUT_MS = 10_000;

/** Subset of `PinoLoggerService` the guards need; the logger itself is resolved lazily. */
export interface GuardLogger {
  log(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
  fatal(payload: Record<string, unknown>, message: string): void;
}

export type ProcessGuardReason = "unhandledRejection" | "uncaughtException";

export interface ProcessErrorSummary {
  name: string;
  message: string;
  /** First stack lines only: enough to locate the throw site, bounded on purpose. */
  stack: string[];
  requestId?: string;
}

export interface ProcessGuardRecent extends ProcessErrorSummary {
  at: number;
}

/** Counters a future `/v1/metrics` gauge can expose without touching a contract. */
export interface ProcessGuardSnapshot {
  degraded: boolean;
  unhandledRejections: number;
  rejectionsInWindow: number;
  windowMs: number;
  threshold: number;
  recent: ProcessGuardRecent[];
  lastAt?: number;
  exiting: boolean;
}

export interface ProcessGuardsOptions {
  /** Resolved lazily: guard installation happens before the Nest logger exists. */
  logger: () => GuardLogger | undefined;
  exit: (code: number) => void;
  /** Graceful teardown (close the HTTP server, DB, Redis) before a fatal exit. */
  onFatal?: (reason: ProcessGuardReason) => Promise<void> | void;
  flush?: () => Promise<void> | void;
  now?: () => number;
  rejectionWindowMs?: number;
  rejectionThreshold?: number;
  recentLimit?: number;
  flushTimeoutMs?: number;
  teardownTimeoutMs?: number;
}

export interface ProcessGuards {
  install(): void;
  uninstall(): void;
  /** Exposed for deterministic tests; the process listeners call the same path. */
  handleUnhandledRejection(reason: unknown): Promise<void>;
  handleUncaughtException(error: unknown): Promise<void>;
  snapshot(): ProcessGuardSnapshot;
  isInstalled(): boolean;
}

const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LINES = 3;

function truncate(value: string): string {
  return value.length > MAX_MESSAGE_LENGTH ? `${value.slice(0, MAX_MESSAGE_LENGTH)}…` : value;
}

function stringifyNonError(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

/**
 * Request-scoped errors may carry the id as a property; `cause` is followed one
 * level so wrapped errors keep it. Never throws on hostile thrown values.
 */
function findRequestId(value: unknown, depth = 0): string | undefined {
  if (depth > 2 || typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.requestId === "string" && record.requestId.trim() !== "") {
    return record.requestId;
  }
  return findRequestId(record.cause, depth + 1);
}

export function describeProcessError(reason: unknown): ProcessErrorSummary {
  if (reason instanceof Error) {
    const stack = (reason.stack ?? `${reason.name}: ${reason.message}`)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .slice(0, MAX_STACK_LINES);
    const requestId = findRequestId(reason);
    return {
      name: reason.name,
      message: truncate(reason.message),
      stack,
      ...(requestId ? { requestId } : {}),
    };
  }

  return {
    name: "NonErrorThrown",
    message: truncate(stringifyNonError(reason)),
    stack: [],
  };
}

class GuardDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Process guard step exceeded ${timeoutMs}ms`);
    this.name = "GuardDeadlineError";
  }
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new GuardDeadlineError(timeoutMs)), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

type FlushHandle = (callback: () => void) => void;

function resolveFlushHandle(target: unknown): FlushHandle | undefined {
  if (typeof target !== "object" || target === null) {
    return undefined;
  }
  const record = target as Record<string, unknown>;
  if (typeof record.flush === "function") {
    return (record.flush as FlushHandle).bind(target);
  }
  const nested = record.logger;
  if (typeof nested === "object" && nested !== null) {
    const flush = (nested as Record<string, unknown>).flush;
    if (typeof flush === "function") {
      return (flush as FlushHandle).bind(nested);
    }
  }
  return undefined;
}

/**
 * Flushes pino's buffer with a hard cap: shutdown must not hang on a stuck
 * transport. Accepts a `PinoLoggerService`, a raw pino logger, or anything with
 * a synchronous/promise `flush`. A missing flush is a no-op.
 */
export async function flushLogger(target: unknown, timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS): Promise<void> {
  const flush = resolveFlushHandle(target);
  if (!flush) {
    return;
  }

  try {
    await withDeadline(
      new Promise<void>((resolve) => {
        flush(resolve);
      }),
      timeoutMs,
    );
  } catch {
    // A slow transport must never block a forced exit.
  }
}

export function createProcessGuards(options: ProcessGuardsOptions): ProcessGuards {
  const windowMs = Math.max(1, options.rejectionWindowMs ?? DEFAULT_REJECTION_WINDOW_MS);
  const threshold = Math.max(1, options.rejectionThreshold ?? DEFAULT_REJECTION_THRESHOLD);
  const recentLimit = Math.max(1, options.recentLimit ?? DEFAULT_RECENT_LIMIT);
  const flushTimeoutMs = options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  const teardownTimeoutMs = options.teardownTimeoutMs ?? DEFAULT_TEARDOWN_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  let rejectionTimes: number[] = [];
  let recent: ProcessGuardRecent[] = [];
  let unhandledRejections = 0;
  let degraded = false;
  let lastAt: number | undefined;
  let exiting = false;
  let installed = false;
  let rejectionListener: ((reason: unknown) => void) | undefined;
  let exceptionListener: ((error: Error) => void) | undefined;

  const log = (
    level: "log" | "warn" | "error" | "fatal",
    payload: Record<string, unknown>,
    message: string,
  ): void => {
    const logger = options.logger();
    if (!logger) {
      return;
    }
    logger[level](payload, message);
  };

  const flushBounded = async (): Promise<void> => {
    if (!options.flush) {
      return;
    }
    try {
      await withDeadline(Promise.resolve().then(() => options.flush?.()), flushTimeoutMs);
    } catch {
      log(
        "error",
        { event: "process.guard", phase: "flush", timeoutMs: flushTimeoutMs },
        "process.guard_flush_timeout",
      );
    }
  };

  /**
   * One exit path for both guards: stop the app through the injected teardown,
   * flush what is still buffered, then leave with code 1. Guarded so a storm of
   * exceptions cannot start concurrent teardowns.
   */
  const exitFatal = async (reason: ProcessGuardReason): Promise<void> => {
    if (exiting) {
      return;
    }
    exiting = true;

    try {
      if (options.onFatal) {
        await withDeadline(Promise.resolve().then(() => options.onFatal?.(reason)), teardownTimeoutMs);
      }
    } catch (error) {
      log(
        "error",
        {
          event: "process.guard",
          guard: reason,
          phase: "teardown",
          err: error,
        },
        "process.guard_teardown_timeout",
      );
    }

    await flushBounded();
    options.exit(1);
  };

  const handleUnhandledRejection = async (reason: unknown): Promise<void> => {
    const at = now();
    rejectionTimes = rejectionTimes.filter((timestamp) => at - timestamp < windowMs);
    rejectionTimes.push(at);

    const summary = describeProcessError(reason);
    recent = [...recent, { at, ...summary }].slice(-recentLimit);
    unhandledRejections += 1;
    degraded = true;
    lastAt = at;

    const windowCount = rejectionTimes.length;
    const shouldExit = windowCount >= threshold;

    log(
      "fatal",
      {
        event: "process.guard",
        guard: "unhandledRejection",
        verdict: shouldExit ? "exit" : "degraded",
        ...summary,
        count: unhandledRejections,
        windowCount,
        threshold,
        windowMs,
        degraded: true,
        ...(summary.requestId ? { requestId: summary.requestId } : {}),
      },
      "unhandled_rejection",
    );

    if (shouldExit) {
      await exitFatal("unhandledRejection");
    }
  };

  const handleUncaughtException = async (error: unknown): Promise<void> => {
    const at = now();
    const summary = describeProcessError(error);
    recent = [...recent, { at, ...summary }].slice(-recentLimit);
    degraded = true;
    lastAt = at;

    log(
      "fatal",
      {
        event: "process.guard",
        guard: "uncaughtException",
        verdict: "exit",
        ...summary,
        count: unhandledRejections,
        windowCount: rejectionTimes.filter((timestamp) => at - timestamp < windowMs).length,
        threshold,
        windowMs,
        degraded: true,
      },
      "uncaught_exception",
    );

    await exitFatal("uncaughtException");
  };

  return {
    install(): void {
      if (installed) {
        return;
      }
      installed = true;

      rejectionListener = (reason: unknown) => {
        void handleUnhandledRejection(reason);
      };
      exceptionListener = (error: Error) => {
        void handleUncaughtException(error);
      };

      process.on("unhandledRejection", rejectionListener);
      process.on("uncaughtException", exceptionListener);
    },

    uninstall(): void {
      if (!installed) {
        return;
      }
      installed = false;

      if (rejectionListener) {
        process.removeListener("unhandledRejection", rejectionListener);
      }
      if (exceptionListener) {
        process.removeListener("uncaughtException", exceptionListener);
      }
      rejectionListener = undefined;
      exceptionListener = undefined;
    },

    handleUnhandledRejection,
    handleUncaughtException,

    snapshot(): ProcessGuardSnapshot {
      const at = now();
      return {
        degraded,
        unhandledRejections,
        rejectionsInWindow: rejectionTimes.filter((timestamp) => at - timestamp < windowMs).length,
        windowMs,
        threshold,
        recent: [...recent],
        ...(lastAt !== undefined ? { lastAt } : {}),
        exiting,
      };
    },

    isInstalled(): boolean {
      return installed;
    },
  };
}