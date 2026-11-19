import type { INestApplication, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { flushLogger, type GuardLogger } from "../common/process-guards.js";
import { withTimeout } from "../common/utils/with-timeout.js";
import { AppConfigService } from "../config/app-config.service.js";
import { validateEnvironment } from "../config/environment.js";
import { loadEnvironmentFiles } from "../config/load-environment.js";
import { PinoLoggerService } from "../modules/observability/pino-logger.service.js";
import { PrismaService } from "../modules/prisma/prisma.service.js";
import { RedisService } from "../modules/redis/redis.service.js";
import { StorageService } from "../modules/storage/storage.service.js";
import { configureApp } from "./configure-app.js";
import {
  createShutdownController,
  resolveShutdownGraceMs,
  type ShutdownController,
  type ShutdownHttpServer,
} from "./shutdown.js";
import { createEarlyLogger, type StartupLogger } from "./startup-logger.js";

/** Names used for both `startup.stage` lines and `startup.failed.stage`. */
export type StartupStageName =
  | "environment"
  | "modules"
  | "nest"
  | "configure"
  | "listen"
  | "dependencies"
  | "database"
  | "redis"
  | "storage"
  | "ready";

export type StartupDependencyState = "up" | "down";

export interface StartupDependencySnapshot {
  database: StartupDependencyState;
  redis: StartupDependencyState;
  storage: StartupDependencyState;
}

/**
 * A bootstrap stage that threw. `stage` is what the fatal log and the exit
 * report as the failure point (`environment`, `nest`, `listen`, ...).
 */
export class StartupFailure extends Error {
  readonly stage: StartupStageName;
  readonly failureCause: unknown;

  constructor(stage: StartupStageName, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${stage} stage failed: ${detail}`, { cause });
    this.name = "StartupFailure";
    this.stage = stage;
    this.failureCause = cause;
  }
}

export interface StartApiOptions {
  /** Early logger override; defaults to a pino instance writing structured JSON. */
  logger?: StartupLogger;
  loadEnvironment?: () => string | undefined;
  importModule?: () => Promise<{ AppModule: unknown }>;
  createApplication?: (appModule: unknown) => Promise<INestApplication>;
  configureApplication?: (app: INestApplication) => void;
  probeDependencies?: (app: INestApplication) => Promise<StartupDependencySnapshot>;
  validateProcessEnvironment?: (environment: Record<string, unknown>) => unknown;
  exit?: (code: number) => void;
  flush?: () => Promise<void> | void;
  shutdownGraceMs?: number;
  /** Tests create controllers without touching the test-runner's signals. */
  registerSignalHandlers?: boolean;
  /** Extra payload for `shutdown.start` / `shutdown.complete` (guard counters). */
  shutdownContext?: () => Record<string, unknown>;
}

export interface StartedApi {
  app: INestApplication;
  logger: GuardLogger;
  shutdown: ShutdownController;
  port: number;
  dependencies: StartupDependencySnapshot;
}

const DEPENDENCY_PROBE_TIMEOUT_MS = 2_500;
const STARTUP_CLEANUP_TIMEOUT_MS = 5_000;

function getProvider<T>(app: INestApplication, token: unknown): T {
  const get = app.get as unknown as (typeOrToken: unknown) => T;
  return get(token);
}

function tryGetProvider<T>(app: INestApplication, token: unknown): T | undefined {
  try {
    return getProvider<T>(app, token);
  } catch {
    return undefined;
  }
}

async function importAppModule(): Promise<{ AppModule: unknown }> {
  return import("../app.module.js");
}

function createNestApplication(appModule: unknown): Promise<INestApplication> {
  // `abortOnError: false` keeps provider-init failures (for example
  // `REDIS_REQUIRED=true` with Redis down) inside this bootstrap so they are
  // logged with their stage instead of being killed by Nest's own exit(1).
  return NestFactory.create(appModule as Type<unknown>, {
    bufferLogs: true,
    abortOnError: false,
  });
}

function configureNestApplication(app: INestApplication): void {
  // Signal handling belongs to bootstrap/shutdown.ts: Nest re-raises the signal
  // and exits 143, and its teardown has no deadline.
  configureApp(app, { shutdownHooks: false });
}

/**
 * Probes every dependency once and logs one `startup.stage` line per dependency.
 *
 * A down hard dependency does **not** kill the boot: readiness already reports
 * `unavailable` (HTTP 503) and the orchestrator removes the instance from the
 * load balancer, while a crash loop would hide the actual failure. This is the
 * same contract R1 established for Redis (`degraded` + 200). What must never
 * happen — and does not — is booting silently: the stage line is emitted at
 * `error` level and `api.started` carries the dependency snapshot.
 */
export async function probeBootDependencies(
  app: INestApplication,
  logger: GuardLogger,
): Promise<StartupDependencySnapshot> {
  const probe = async (
    name: "database" | "redis" | "storage",
    hardDependency: boolean,
    operation: () => Promise<unknown>,
  ): Promise<StartupDependencyState> => {
    const startedAt = Date.now();
    try {
      await withTimeout(
        operation(),
        DEPENDENCY_PROBE_TIMEOUT_MS,
        `${name} startup probe timed out`,
      );
      logger.log(
        { event: "startup.stage", stage: name, status: "up", durationMs: Date.now() - startedAt },
        "startup.stage",
      );
      return "up";
    } catch (error) {
      logger.error(
        {
          event: "startup.stage",
          stage: name,
          status: "down",
          durationMs: Date.now() - startedAt,
          err: error,
          hardDependency,
          servingDegraded: true,
          readiness: hardDependency ? "unavailable" : "degraded",
        },
        "startup.dependency_unavailable",
      );
      return "down";
    }
  };

  // Sequential on purpose: `startup.stage` lines must read in boot order.
  const database = await probe("database", true, () =>
    getProvider<PrismaService>(app, PrismaService).healthCheck(),
  );
  const redis = await probe("redis", false, () =>
    getProvider<RedisService>(app, RedisService).ping(),
  );
  const storage = await probe("storage", true, () =>
    getProvider<StorageService>(app, StorageService).checkHealth(),
  );

  return { database, redis, storage };
}

/**
 * Boot the API with explicit stages, a fatal log carrying the failing stage,
 * and a graceful shutdown controller owning SIGTERM/SIGINT.
 *
 * Every stage emits exactly one `startup.stage` line with its duration, so a
 * hung boot is attributable at a glance. Any thrown stage is fatal: it is
 * logged with `stage` and the process exits 1 — never "listening but not
 * started" without a trace.
 */
export async function startApi(options: StartApiOptions = {}): Promise<StartedApi> {
  let logger: GuardLogger = options.logger ?? createEarlyLogger();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const startedAt = Date.now();
  let currentStage: StartupStageName = "environment";
  let app: INestApplication | undefined;
  let shutdown: ShutdownController | undefined;

  const stage = async <T>(name: StartupStageName, operation: () => Promise<T> | T): Promise<T> => {
    currentStage = name;
    const stageStartedAt = Date.now();
    try {
      const value = await operation();
      logger.log(
        {
          event: "startup.stage",
          stage: name,
          status: "ok",
          durationMs: Math.max(0, Date.now() - stageStartedAt),
        },
        "startup.stage",
      );
      return value;
    } catch (error) {
      logger.fatal(
        {
          event: "startup.stage",
          stage: name,
          status: "failed",
          durationMs: Math.max(0, Date.now() - stageStartedAt),
          err: error,
        },
        "startup.stage",
      );
      throw error instanceof StartupFailure ? error : new StartupFailure(name, error);
    }
  };

  try {
    const environment = await stage("environment", () => {
      const environmentFile = (options.loadEnvironment ?? loadEnvironmentFiles)();
      // Validate here, not inside Nest: a bad env is an `environment` failure,
      // not an opaque DI failure.
      (options.validateProcessEnvironment ?? validateEnvironment)(
        process.env as Record<string, unknown>,
      );
      const shutdownGraceMs =
        options.shutdownGraceMs ?? resolveShutdownGraceMs(process.env.SHUTDOWN_GRACE_MS);
      return { environmentFile, shutdownGraceMs };
    });
    const { environmentFile, shutdownGraceMs: graceMs } = environment;

    const module = await stage("modules", () => (options.importModule ?? importAppModule)());

    app = await stage("nest", () =>
      (options.createApplication ?? createNestApplication)(module.AppModule),
    );
    const nestApp = app;

    await stage("configure", () =>
      (options.configureApplication ?? configureNestApplication)(nestApp),
    );

    const nestLogger = tryGetProvider<PinoLoggerService>(nestApp, PinoLoggerService);
    if (nestLogger) {
      logger = nestLogger;
    }

    const config = tryGetProvider<AppConfigService>(nestApp, AppConfigService);
    if (!config) {
      throw new StartupFailure("configure", new Error("AppConfigService is not available"));
    }

    await stage("listen", () => nestApp.listen(config.apiPort));

    shutdown = createShutdownController({
      closeApplication: () => nestApp.close(),
      logger: () => logger,
      exit,
      flush: () => (options.flush ? options.flush() : flushLogger(logger)),
      graceMs,
      httpServer: nestApp.getHttpServer() as ShutdownHttpServer,
      context: options.shutdownContext,
    });
    if (options.registerSignalHandlers !== false) {
      shutdown.installSignals();
    }

    currentStage = "dependencies";
    const dependencies = await (options.probeDependencies ??
      ((target: INestApplication) => probeBootDependencies(target, logger)))(nestApp);

    currentStage = "ready";
    logger.log(
      { event: "startup.stage", stage: "ready", status: "ok", durationMs: 0 },
      "startup.stage",
    );
    logger.log(
      {
        event: "startup.complete",
        port: config.apiPort,
        apiUrl: config.apiUrl,
        environmentFile,
        startupMs: Math.max(0, Date.now() - startedAt),
        shutdownGraceMs: graceMs,
        dependencies,
      },
      "api.started",
    );

    return { app: nestApp, logger, shutdown, port: config.apiPort, dependencies };
  } catch (error) {
    const failure = error instanceof StartupFailure ? error : new StartupFailure(currentStage, error);
    logger.fatal(
      {
        event: "startup.failed",
        stage: failure.stage,
        startupMs: Math.max(0, Date.now() - startedAt),
        err: failure.failureCause instanceof Error ? failure.failureCause : failure,
      },
      "startup.failed",
    );

    shutdown?.uninstallSignals();
    if (app) {
      try {
        await withTimeout(app.close(), STARTUP_CLEANUP_TIMEOUT_MS, "startup cleanup timed out");
      } catch {
        // Nothing left to release; the fatal entry above already explains the boot failure.
      }
    }

    await flushLogger(logger);
    exit(1);
    throw failure;
  }
}