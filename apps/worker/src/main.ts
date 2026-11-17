import { loadLocalEnvironment, readWorkerConfig } from "./config.js";
import { defaultProcessors } from "./jobs/index.js";
import { createLogger, serializeError } from "./logger.js";
import { QUEUE_NAMES, redisConnectionOptions, startWorkerRuntime } from "./queue.js";

async function main(): Promise<void> {
  const environmentFile = loadLocalEnvironment();
  const config = readWorkerConfig(environmentFile);
  const logger = createLogger(config.logLevel);

  logger.info(
    {
      event: "worker.starting",
      environmentFile,
      queues: QUEUE_NAMES,
      redisPrefix: config.redisPrefix,
    },
    "starting worker runtime",
  );

  const runtime = await startWorkerRuntime({
    redisUrl: config.redisUrl,
    prefix: config.redisPrefix,
    processors: defaultProcessors,
    logger,
  });

  logger.info(
    {
      event: "worker.ready",
      queues: runtime.queueNames,
      redisPrefix: runtime.prefix,
      redisHost: redisConnectionOptions(config.redisUrl).host,
    },
    "worker runtime ready",
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(
      {
        event: "worker.stopping",
        signal,
        queues: runtime.queueNames,
        redisPrefix: runtime.prefix,
      },
      "graceful shutdown started",
    );

    try {
      await runtime.close();
      logger.info(
        {
          event: "worker.stopped",
          signal,
          queues: runtime.queueNames,
          redisPrefix: runtime.prefix,
        },
        "worker runtime stopped",
      );
    } catch (error) {
      logger.error(
        {
          event: "worker.shutdown_failed",
          signal,
          error: serializeError(error),
        },
        "worker shutdown failed",
      );
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  const logger = createLogger(process.env.LOG_LEVEL ?? "info");
  logger.error(
    {
      event: "worker.startup_failed",
      error: serializeError(error),
    },
    "worker failed to start",
  );
  process.exitCode = 1;
});
