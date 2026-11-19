import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../../modules/prisma/prisma.service.js";
import { RedisService } from "../../modules/redis/redis.service.js";
import { StorageService } from "../../modules/storage/storage.service.js";
import { startApi } from "../bootstrap.js";

function createLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function createFakeApp(options: { listen?: () => Promise<unknown> } = {}) {
  const healthCheck = vi.fn(async () => undefined);
  const ping = vi.fn(async () => undefined);
  const checkHealth = vi.fn(async () => undefined);
  const listen = vi.fn(options.listen ?? (async () => undefined));
  const close = vi.fn(async () => undefined);
  const httpServer = {
    close: vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
    }),
    closeIdleConnections: vi.fn(),
    on: vi.fn(),
  };

  const app = {
    get: vi.fn((token: unknown) => {
      if (token === AppConfigService) {
        return { apiPort: 4100, apiUrl: "http://localhost:4100" };
      }
      if (token === PrismaService) {
        return { healthCheck };
      }
      if (token === RedisService) {
        return { ping };
      }
      if (token === StorageService) {
        return { checkHealth };
      }
      // `PinoLoggerService` is intentionally unavailable: the injected logger
      // must keep receiving the stage entries.
      throw new Error("provider not registered in the fake app");
    }),
    listen,
    getHttpServer: vi.fn(() => httpServer),
    close,
  };

  return { app: app as unknown as INestApplication, listen, close, healthCheck, ping, checkHealth };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SHUTDOWN_GRACE_MS;
});

describe("startApi", () => {
  it("logs every stage in order and reports the dependency snapshot", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const fake = createFakeApp();

    const started = await startApi({
      logger,
      loadEnvironment: () => "/tmp/roamlog/.env.test",
      validateProcessEnvironment: () => undefined,
      importModule: async () => ({ AppModule: {} }),
      createApplication: async () => fake.app,
      configureApplication: () => undefined,
      exit,
      flush: async () => undefined,
      registerSignalHandlers: false,
      shutdownGraceMs: 1_000,
    });

    expect(exit).not.toHaveBeenCalled();
    expect(started.port).toBe(4100);
    expect(fake.listen).toHaveBeenCalledWith(4100);
    expect(fake.healthCheck).toHaveBeenCalledTimes(1);
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(fake.checkHealth).toHaveBeenCalledTimes(1);

    const stageNames = logger.log.mock.calls
      .filter(([, message]) => message === "startup.stage")
      .map(([payload]) => payload.stage);
    expect(stageNames).toEqual([
      "environment",
      "modules",
      "nest",
      "configure",
      "listen",
      "database",
      "redis",
      "storage",
      "ready",
    ]);

    const startedLog = logger.log.mock.calls.find(([, message]) => message === "api.started");
    expect(startedLog?.[0]).toMatchObject({
      event: "startup.complete",
      port: 4100,
      environmentFile: "/tmp/roamlog/.env.test",
      shutdownGraceMs: 1_000,
      dependencies: { database: "up", redis: "up", storage: "up" },
    });
  });

  it("marks a down dependency loudly but keeps the process up", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const fake = createFakeApp();
    fake.healthCheck.mockRejectedValueOnce(new Error("ECONNREFUSED 5432"));

    const started = await startApi({
      logger,
      loadEnvironment: () => undefined,
      validateProcessEnvironment: () => undefined,
      importModule: async () => ({ AppModule: {} }),
      createApplication: async () => fake.app,
      configureApplication: () => undefined,
      exit,
      flush: async () => undefined,
      registerSignalHandlers: false,
      shutdownGraceMs: 1_000,
    });

    expect(exit).not.toHaveBeenCalled();
    expect(started.dependencies).toMatchObject({ database: "down" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "startup.stage",
        stage: "database",
        status: "down",
        hardDependency: true,
        readiness: "unavailable",
      }),
      "startup.dependency_unavailable",
    );
  });

  it("logs the failing stage and exits 1 when the Nest application cannot be created", async () => {
    const logger = createLogger();
    const exit = vi.fn();

    await expect(
      startApi({
        logger,
        loadEnvironment: () => undefined,
        validateProcessEnvironment: () => undefined,
        importModule: async () => ({ AppModule: {} }),
        createApplication: async () => {
          throw new Error("provider init failed");
        },
        exit,
        flush: async () => undefined,
        registerSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ name: "StartupFailure", stage: "nest" });

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    const failed = logger.fatal.mock.calls.find(([, message]) => message === "startup.failed");
    expect(failed?.[0]).toMatchObject({ event: "startup.failed", stage: "nest" });
    const stageFailed = logger.fatal.mock.calls.find(
      ([payload, message]) => message === "startup.stage" && payload.status === "failed",
    );
    expect(stageFailed?.[0]).toMatchObject({ stage: "nest", status: "failed" });
  });

  it("reports listen, closes the half-started app and exits 1 when the port is taken", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const fake = createFakeApp({
      listen: async () => {
        throw Object.assign(new Error("listen EADDRINUSE: address already in use"), {
          code: "EADDRINUSE",
        });
      },
    });

    await expect(
      startApi({
        logger,
        loadEnvironment: () => undefined,
        validateProcessEnvironment: () => undefined,
        importModule: async () => ({ AppModule: {} }),
        createApplication: async () => fake.app,
        configureApplication: () => undefined,
        exit,
        flush: async () => undefined,
        registerSignalHandlers: false,
        shutdownGraceMs: 1_000,
      }),
    ).rejects.toMatchObject({ stage: "listen" });

    expect(exit).toHaveBeenCalledWith(1);
    expect(fake.close).toHaveBeenCalledTimes(1);
    const failed = logger.fatal.mock.calls.find(([, message]) => message === "startup.failed");
    expect(failed?.[0]).toMatchObject({ event: "startup.failed", stage: "listen" });
  });

  it("fails the environment stage when SHUTDOWN_GRACE_MS is not a number", async () => {
    process.env.SHUTDOWN_GRACE_MS = "asap";
    const logger = createLogger();
    const exit = vi.fn();

    await expect(
      startApi({
        logger,
        loadEnvironment: () => undefined,
        validateProcessEnvironment: () => undefined,
        importModule: async () => ({ AppModule: {} }),
        exit,
        flush: async () => undefined,
        registerSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ stage: "environment" });

    expect(exit).toHaveBeenCalledWith(1);
    const failed = logger.fatal.mock.calls.find(([, message]) => message === "startup.failed");
    expect(failed?.[0]).toMatchObject({ event: "startup.failed", stage: "environment" });
  });

  it("fails the environment stage when configuration validation throws", async () => {
    const logger = createLogger();
    const exit = vi.fn();

    await expect(
      startApi({
        logger,
        loadEnvironment: () => undefined,
        validateProcessEnvironment: () => {
          throw new Error("DATABASE_URL is required");
        },
        exit,
        flush: async () => undefined,
        registerSignalHandlers: false,
      }),
    ).rejects.toMatchObject({ stage: "environment" });

    expect(exit).toHaveBeenCalledWith(1);
  });
});