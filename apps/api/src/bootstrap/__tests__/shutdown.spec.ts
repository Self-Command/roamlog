import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SHUTDOWN_GRACE_MS,
  createShutdownController,
  resolveShutdownGraceMs,
  type ShutdownHttpServer,
} from "../shutdown.js";

interface FakeResponse {
  once?(event: "close", listener: () => void): void;
}

function createLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function createFakeServer() {
  let requestListener: ((request: unknown, response: FakeResponse) => void) | undefined;
  const close = vi.fn((callback?: (error?: Error) => void) => {
    callback?.();
  });
  const closeIdleConnections = vi.fn();
  const server = {
    close,
    closeIdleConnections,
    on: vi.fn((_event: "request", listener: typeof requestListener) => {
      requestListener = listener;
    }),
    removeListener: vi.fn(),
  } as unknown as ShutdownHttpServer;

  return {
    server,
    close,
    closeIdleConnections,
    emitRequest(): { closeResponse(): void } {
      let closeResponse: () => void = () => undefined;
      const response: FakeResponse = {
        once: (_event, listener) => {
          closeResponse = listener;
        },
      };
      requestListener?.({}, response);
      return {
        closeResponse: () => {
          closeResponse();
        },
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveShutdownGraceMs", () => {
  it("defaults to 10s", () => {
    expect(resolveShutdownGraceMs(undefined)).toBe(DEFAULT_SHUTDOWN_GRACE_MS);
    expect(resolveShutdownGraceMs("")).toBe(DEFAULT_SHUTDOWN_GRACE_MS);
    expect(DEFAULT_SHUTDOWN_GRACE_MS).toBe(10_000);
  });

  it("accepts a valid millisecond budget and rejects garbage", () => {
    expect(resolveShutdownGraceMs("2500")).toBe(2500);
    expect(resolveShutdownGraceMs("0")).toBe(0);
    expect(() => resolveShutdownGraceMs("soon")).toThrow(/SHUTDOWN_GRACE_MS/);
    expect(() => resolveShutdownGraceMs("-1")).toThrow(/SHUTDOWN_GRACE_MS/);
    expect(() => resolveShutdownGraceMs("300001")).toThrow(/SHUTDOWN_GRACE_MS/);
  });
});

describe("graceful shutdown", () => {
  it("stops accepting, closes the app, flushes and exits 0", async () => {
    const server = createFakeServer();
    const closeApplication = vi.fn(async () => undefined);
    const exit = vi.fn();
    const flush = vi.fn(async () => undefined);
    const logger = createLogger();
    const controller = createShutdownController({
      closeApplication,
      logger: () => logger,
      exit,
      flush,
      graceMs: 5_000,
      httpServer: server.server,
    });

    await controller.shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(closeApplication).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    const start = logger.log.mock.calls.find(([, message]) => message === "shutdown.start");
    expect(start?.[0]).toMatchObject({ event: "shutdown.start", reason: "SIGTERM", graceMs: 5_000 });
    const complete = logger.log.mock.calls.find(([, message]) => message === "shutdown.complete");
    expect(complete?.[0]).toMatchObject({
      event: "shutdown.complete",
      ok: true,
      timedOut: false,
      exitCode: 0,
    });
  });

  it("runs the close chain once for two signals", async () => {
    const server = createFakeServer();
    const closeApplication = vi.fn(async () => undefined);
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({
      closeApplication,
      logger: () => logger,
      exit,
      flush: async () => undefined,
      graceMs: 5_000,
      httpServer: server.server,
    });

    await Promise.all([controller.shutdown("SIGTERM"), controller.shutdown("SIGTERM")]);

    expect(closeApplication).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "shutdown.duplicate_signal" }),
      "shutdown.duplicate_signal",
    );
  });

  it("waits for an in-flight request before closing dependencies", async () => {
    const server = createFakeServer();
    const closeApplication = vi.fn(async () => undefined);
    const controller = createShutdownController({
      closeApplication,
      logger: () => createLogger(),
      exit: vi.fn(),
      flush: async () => undefined,
      graceMs: 5_000,
      httpServer: server.server,
    });

    const request = server.emitRequest();
    expect(controller.inFlightRequests()).toBe(1);

    const shutdown = controller.shutdown("SIGTERM");
    await Promise.resolve();
    expect(closeApplication).not.toHaveBeenCalled();

    request.closeResponse();
    await shutdown;

    expect(controller.inFlightRequests()).toBe(0);
    expect(closeApplication).toHaveBeenCalledTimes(1);
  });

  it("force-exits 1 when the grace budget runs out", async () => {
    vi.useFakeTimers();
    const server = createFakeServer();
    const closeApplication = vi.fn(() => new Promise<void>(() => undefined));
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({
      closeApplication,
      logger: () => logger,
      exit,
      flush: async () => undefined,
      graceMs: 5_000,
      httpServer: server.server,
    });

    const shutdown = controller.shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_500);
    await shutdown;

    expect(closeApplication).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "shutdown.timeout", graceMs: 5_000 }),
      "shutdown.timeout",
    );
    const complete = logger.error.mock.calls.find(
      ([payload]) => payload.event === "shutdown.complete",
    );
    expect(complete?.[0]).toMatchObject({ ok: false, timedOut: true, exitCode: 1 });
  });

  it("exits 1 when closing the application throws", async () => {
    const server = createFakeServer();
    const closeApplication = vi.fn(async () => {
      throw new Error("disconnect failed");
    });
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({
      closeApplication,
      logger: () => logger,
      exit,
      flush: async () => undefined,
      graceMs: 5_000,
      httpServer: server.server,
    });

    await controller.shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ event: "shutdown.failed" }),
      "shutdown.failed",
    );
  });

  it("ignores a server that is already closed", async () => {
    const error = Object.assign(new Error("Server is not running"), {
      code: "ERR_SERVER_NOT_RUNNING",
    });
    const close = vi.fn((callback?: (error?: Error) => void) => {
      callback?.(error);
    });
    const logger = createLogger();
    const controller = createShutdownController({
      closeApplication: async () => undefined,
      logger: () => logger,
      exit: vi.fn(),
      flush: async () => undefined,
      graceMs: 1_000,
      httpServer: {
        close,
        closeIdleConnections: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    });

    await controller.close("test");

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("still exits 0 when flushing the logger times out", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const controller = createShutdownController({
      closeApplication: async () => undefined,
      logger: () => createLogger(),
      exit,
      flush: () => new Promise<void>(() => undefined),
      graceMs: 500,
      httpServer: createFakeServer().server,
    });

    const shutdown = controller.shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(3_000);
    await shutdown;

    expect(exit).toHaveBeenCalledWith(0);
  });

  it("installs signal handlers once and removes them again", async () => {
    const closeApplication = vi.fn(async () => undefined);
    const exit = vi.fn();
    const controller = createShutdownController({
      closeApplication,
      logger: () => createLogger(),
      exit,
      flush: async () => undefined,
      graceMs: 5_000,
      httpServer: createFakeServer().server,
    });
    const before = process.listenerCount("SIGTERM");

    controller.installSignals(["SIGTERM"]);
    controller.installSignals(["SIGTERM"]);
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);

    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGTERM", "SIGTERM");
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });

    expect(closeApplication).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    controller.uninstallSignals();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});