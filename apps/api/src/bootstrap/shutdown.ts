/**
 * Graceful shutdown for the API process.
 *
 * `app.enableShutdownHooks()` cannot be the last word here: Nest re-raises the
 * received signal after `close()` (`process.kill(process.pid, signal)`), so a
 * normal SIGTERM leaves the container with exit code 143 instead of 0, and its
 * teardown has no deadline. This controller owns the signals instead:
 *
 *   1. stop accepting new requests (close the listener, drop idle keep-alives)
 *   2. wait for in-flight requests
 *   3. close the application (Nest disposes Socket.IO, Prisma, Redis, queues)
 *   4. flush the logger and exit 0 — or 1 when the grace budget ran out
 *
 * Every step is bounded by `SHUTDOWN_GRACE_MS`; repeated signals share the same
 * in-flight close promise, so the teardown chain runs exactly once.
 */

import { flushLogger, type GuardLogger } from "../common/process-guards.js";

export const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
export const MAX_SHUTDOWN_GRACE_MS = 300_000;

type ShutdownLogger = GuardLogger;

interface ShutdownHttpResponse {
  once?(event: "close", listener: () => void): unknown;
  on?(event: "close", listener: () => void): unknown;
}

export interface ShutdownHttpServer {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?: () => void;
  on?(event: "request", listener: (request: unknown, response: ShutdownHttpResponse) => void): void;
  removeListener?(
    event: "request",
    listener: (request: unknown, response: ShutdownHttpResponse) => void,
  ): void;
}

export interface ShutdownOptions {
  closeApplication: () => Promise<void>;
  logger: () => ShutdownLogger | undefined;
  exit: (code: number) => void;
  graceMs: number;
  flush?: () => Promise<void> | void;
  flushTimeoutMs?: number;
  httpServer?: ShutdownHttpServer;
  now?: () => number;
  /** Extra structured fields (for example the process-guard counters). */
  context?: () => Record<string, unknown>;
}

export interface ShutdownOutcome {
  ok: boolean;
  timedOut: boolean;
  durationMs: number;
}

export interface ShutdownController {
  readonly isShuttingDown: boolean;
  /** Idempotent teardown without exiting; used by the fatal process guards too. */
  close(reason: string): Promise<ShutdownOutcome>;
  /** Teardown, flush, exit. Signals call this with code 0. */
  shutdown(reason: string, exitCode?: number): Promise<void>;
  installSignals(signals?: readonly NodeJS.Signals[]): void;
  uninstallSignals(): void;
  inFlightRequests(): number;
}

class ShutdownTimeoutError extends Error {
  constructor(
    readonly graceMs: number,
    readonly inFlight: number,
  ) {
    super(`Graceful shutdown exceeded ${graceMs}ms with ${inFlight} request(s) in flight`);
    this.name = "ShutdownTimeoutError";
  }
}

class DeadlineExceededError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`deadline ${timeoutMs}ms exceeded`);
    this.name = "DeadlineExceededError";
  }
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(timeoutMs)), timeoutMs);
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

/**
 * `SHUTDOWN_GRACE_MS`, validated rather than clamped: a typo in an env file is
 * a configuration error and must fail the `environment` startup stage, not be
 * silently replaced by the default.
 */
export function resolveShutdownGraceMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SHUTDOWN_GRACE_MS;
  }

  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SHUTDOWN_GRACE_MS) {
    throw new Error(
      `SHUTDOWN_GRACE_MS must be an integer between 0 and ${MAX_SHUTDOWN_GRACE_MS} (received "${raw}")`,
    );
  }
  return parsed;
}

export function createShutdownController(options: ShutdownOptions): ShutdownController {
  const logger = (): ShutdownLogger | undefined => options.logger();
  const now = options.now ?? Date.now;
  const graceMs = Math.max(0, options.graceMs);
  const flushTimeoutMs = options.flushTimeoutMs ?? 2_000;

  let inFlight = 0;
  const idleWaiters: Array<() => void> = [];
  let closePromise: Promise<ShutdownOutcome> | undefined;
  let exitRequested = false;
  const signalHandlers = new Map<string, () => void>();

  const requestListener = (_request: unknown, response: ShutdownHttpResponse): void => {
    inFlight += 1;
    let settled = false;
    const settle = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) {
        for (const resolve of idleWaiters.splice(0)) {
          resolve();
        }
      }
    };

    if (typeof response.once === "function") {
      response.once("close", settle);
    } else if (typeof response.on === "function") {
      response.on("close", settle);
    } else {
      settle();
    }
  };

  if (options.httpServer?.on) {
    try {
      options.httpServer.on("request", requestListener);
    } catch {
      // A test double or an exotic adapter without request events: in-flight
      // tracking degrades to "unknown", the grace deadline still bounds us.
    }
  }

  const waitForInFlight = (): Promise<void> => {
    if (inFlight === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
    });
  };

  const stopAccepting = (): void => {
    const server = options.httpServer;
    if (!server) {
      return;
    }

    server.closeIdleConnections?.();
    try {
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          logger()?.warn(
            { event: "shutdown.server_close_failed", err: error },
            "shutdown.server_close_failed",
          );
        }
      });
    } catch (error) {
      logger()?.warn({ event: "shutdown.server_close_failed", err: error }, "shutdown.server_close_failed");
    }
  };

  const drain = async (): Promise<void> => {
    stopAccepting();
    await waitForInFlight();
    await options.closeApplication();
  };

  const flushBounded = async (): Promise<void> => {
    if (options.flush) {
      await withDeadline(Promise.resolve().then(() => options.flush?.()), flushTimeoutMs).catch(
        () => undefined,
      );
      return;
    }
    await flushLogger(logger(), flushTimeoutMs);
  };

  const close = (reason: string): Promise<ShutdownOutcome> => {
    if (closePromise) {
      return closePromise;
    }

    closePromise = (async (): Promise<ShutdownOutcome> => {
      const startedAt = now();
      logger()?.log(
        {
          event: "shutdown.start",
          reason,
          graceMs,
          inFlight,
          ...options.context?.(),
        },
        "shutdown.start",
      );

      try {
        await withDeadline(drain(), graceMs).catch((error: unknown) => {
          throw error instanceof DeadlineExceededError
            ? new ShutdownTimeoutError(graceMs, inFlight)
            : error;
        });

        return {
          ok: true,
          timedOut: false,
          durationMs: Math.max(0, now() - startedAt),
        };
      } catch (error) {
        const timedOut = error instanceof ShutdownTimeoutError;
        const durationMs = Math.max(0, now() - startedAt);

        if (timedOut) {
          logger()?.error(
            {
              event: "shutdown.timeout",
              reason,
              graceMs,
              inFlight,
              durationMs,
              ...options.context?.(),
            },
            "shutdown.timeout",
          );
        } else {
          logger()?.fatal(
            { event: "shutdown.failed", reason, durationMs, err: error, ...options.context?.() },
            "shutdown.failed",
          );
        }

        return { ok: false, timedOut, durationMs };
      }
    })();

    return closePromise;
  };

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (exitRequested) {
      logger()?.log(
        { event: "shutdown.duplicate_signal", reason, inFlight },
        "shutdown.duplicate_signal",
      );
      return;
    }
    exitRequested = true;

    const outcome = await close(reason);
    const code = outcome.ok ? exitCode : 1;

    const level = outcome.ok ? "log" : outcome.timedOut ? "error" : "fatal";
    logger()?.[level](
      {
        event: "shutdown.complete",
        reason,
        ok: outcome.ok,
        timedOut: outcome.timedOut,
        durationMs: outcome.durationMs,
        exitCode: code,
        inFlight,
        ...options.context?.(),
      },
      "shutdown.complete",
    );

    await flushBounded();
    options.exit(code);
  };

  return {
    get isShuttingDown(): boolean {
      return closePromise !== undefined;
    },

    close,
    shutdown,

    installSignals(signals: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"]): void {
      for (const signal of signals) {
        if (signalHandlers.has(signal)) {
          continue;
        }
        const handler = (): void => {
          void shutdown(signal, 0);
        };
        signalHandlers.set(signal, handler);
        process.on(signal, handler);
      }
    },

    uninstallSignals(): void {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      signalHandlers.clear();
    },

    inFlightRequests(): number {
      return inFlight;
    },
  };
}