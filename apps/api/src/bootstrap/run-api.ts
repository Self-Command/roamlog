import { createProcessGuards, flushLogger } from "../common/process-guards.js";
import { startApi } from "./bootstrap.js";
import type { ShutdownController } from "./shutdown.js";
import { createEarlyLogger, type StartupLogger } from "./startup-logger.js";

export interface RunApiProcessOptions {
  /** Tests replace this to assert exit codes without terminating the runner. */
  exit?: (code: number) => void;
  logger?: StartupLogger;
}

/**
 * Production entry: install the process guards first, then boot the API.
 *
 * The guards are installed before Nest exists so a rejection during dependency
 * wiring is still logged and still exits through the graceful path. Their
 * logger and shutdown controller are resolved lazily, and `startApi` swaps in
 * the application logger once DI is up.
 */
export async function runApiProcess(options: RunApiProcessOptions = {}): Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let logger: StartupLogger = options.logger ?? createEarlyLogger();
  let shutdown: ShutdownController | undefined;

  const guards = createProcessGuards({
    logger: () => logger,
    exit,
    flush: () => flushLogger(logger),
    onFatal: async (reason) => {
      if (!shutdown) {
        return;
      }
      // Best-effort tear-down inside the guard's own deadline; the guard exits.
      const outcome = await shutdown.close(reason);
      logger.log(
        {
          event: "shutdown.complete",
          reason,
          fatal: true,
          ok: outcome.ok,
          timedOut: outcome.timedOut,
          durationMs: outcome.durationMs,
          exitCode: 1,
          processGuards: guards.snapshot(),
        },
        "shutdown.complete",
      );
    },
  });
  guards.install();

  try {
    const started = await startApi({
      logger,
      exit,
      flush: () => flushLogger(logger),
      shutdownContext: () => ({ processGuards: guards.snapshot() }),
    });
    logger = started.logger;
    shutdown = started.shutdown;
  } catch {
    // `startApi` already logged `startup.failed` with the failing stage, flushed
    // the logger, and called `exit(1)`. Nothing is left to do here.
    return;
  }
}