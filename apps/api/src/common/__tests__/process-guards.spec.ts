import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REJECTION_THRESHOLD,
  DEFAULT_REJECTION_WINDOW_MS,
  createProcessGuards,
  describeProcessError,
  flushLogger,
} from "../process-guards.js";

function createLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("describeProcessError", () => {
  it("keeps the message, three stack lines and a nested request id", () => {
    const cause = Object.assign(new Error("inner"), { requestId: "req-123" });
    const error = new Error("wrapped", { cause });

    const summary = describeProcessError(error);

    expect(summary.name).toBe("Error");
    expect(summary.message).toBe("wrapped");
    expect(summary.stack).toHaveLength(3);
    expect(summary.stack[0]).toContain("wrapped");
    expect(summary.requestId).toBe("req-123");
  });

  it("never throws on a non-error rejection value", () => {
    const summary = describeProcessError({ weird: true });
    expect(summary.name).toBe("NonErrorThrown");
    expect(summary.stack).toEqual([]);
    expect(summary.message).toContain("weird");
  });
});

describe("process guards", () => {
  it("records a single unhandled rejection as degraded without exiting", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const flush = vi.fn(async () => undefined);
    const onFatal = vi.fn(async () => undefined);
    const guards = createProcessGuards({ logger: () => logger, exit, flush, onFatal });

    await guards.handleUnhandledRejection(new Error("forgotten await"));

    expect(exit).not.toHaveBeenCalled();
    expect(onFatal).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(logger.fatal).toHaveBeenCalledTimes(1);

    const [payload, message] = logger.fatal.mock.calls[0]!;
    expect(message).toBe("unhandled_rejection");
    expect(payload).toMatchObject({
      event: "process.guard",
      guard: "unhandledRejection",
      verdict: "degraded",
      count: 1,
      windowCount: 1,
      degraded: true,
    });

    expect(guards.snapshot()).toMatchObject({
      degraded: true,
      unhandledRejections: 1,
      rejectionsInWindow: 1,
      threshold: DEFAULT_REJECTION_THRESHOLD,
      windowMs: DEFAULT_REJECTION_WINDOW_MS,
      exiting: false,
    });
    expect(guards.snapshot().recent).toHaveLength(1);
    expect(guards.snapshot().recent[0]?.message).toBe("forgotten await");
  });

  it("keeps only the last five rejection summaries", async () => {
    const logger = createLogger();
    let clock = 0;
    const guards = createProcessGuards({
      logger: () => logger,
      exit: vi.fn(),
      now: () => clock,
    });

    for (let index = 0; index < 7; index += 1) {
      clock = index * 10;
      await guards.handleUnhandledRejection(new Error(`rejection-${index}`));
    }

    const recent = guards.snapshot().recent;
    expect(recent).toHaveLength(5);
    expect(recent.map((entry) => entry.message)).toEqual([
      "rejection-2",
      "rejection-3",
      "rejection-4",
      "rejection-5",
      "rejection-6",
    ]);
  });

  it("exits 1 after 10 rejections within 60s, through the graceful teardown", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const flush = vi.fn(async () => undefined);
    const onFatal = vi.fn(async () => undefined);
    let clock = 0;
    const guards = createProcessGuards({
      logger: () => logger,
      exit,
      flush,
      onFatal,
      now: () => clock,
    });

    for (let index = 0; index < 9; index += 1) {
      clock = index * 100;
      await guards.handleUnhandledRejection(new Error(`flood-${index}`));
    }
    expect(exit).not.toHaveBeenCalled();

    clock = 900;
    await guards.handleUnhandledRejection(new Error("flood-final"));

    expect(onFatal).toHaveBeenCalledWith("unhandledRejection");
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);

    const last = logger.fatal.mock.calls.at(-1)!;
    expect(last[1]).toBe("unhandled_rejection");
    expect(last[0]).toMatchObject({
      event: "process.guard",
      verdict: "exit",
      count: 10,
      windowCount: 10,
      threshold: 10,
    });
    expect(guards.snapshot()).toMatchObject({ exiting: true });
  });

  it("slides the 60s window so a rejection after it resets the counter", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    let clock = 0;
    const guards = createProcessGuards({
      logger: () => logger,
      exit,
      flush: vi.fn(async () => undefined),
      now: () => clock,
    });

    for (let index = 0; index < 9; index += 1) {
      clock = index * 100;
      await guards.handleUnhandledRejection(new Error(`burst-${index}`));
    }
    expect(exit).not.toHaveBeenCalled();

    // 61s later every earlier timestamp has left the window.
    clock = 61_000;
    await guards.handleUnhandledRejection(new Error("after-window"));
    expect(exit).not.toHaveBeenCalled();
    expect(guards.snapshot().rejectionsInWindow).toBe(1);

    for (let index = 0; index < 8; index += 1) {
      clock = 61_100 + index * 100;
      await guards.handleUnhandledRejection(new Error(`post-${index}`));
    }
    expect(exit).not.toHaveBeenCalled();
    expect(guards.snapshot().rejectionsInWindow).toBe(9);

    clock = 62_000;
    await guards.handleUnhandledRejection(new Error("post-final"));
    expect(exit).toHaveBeenCalledWith(1);
    expect(guards.snapshot().unhandledRejections).toBe(19);
  });

  it("logs and exits 1 on an uncaught exception", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const flush = vi.fn(async () => undefined);
    const onFatal = vi.fn(async () => undefined);
    const guards = createProcessGuards({ logger: () => logger, exit, flush, onFatal });

    await guards.handleUncaughtException(new Error("broken invariant"));

    expect(logger.fatal).toHaveBeenCalledTimes(1);
    const [payload, message] = logger.fatal.mock.calls[0]!;
    expect(message).toBe("uncaught_exception");
    expect(payload).toMatchObject({
      event: "process.guard",
      guard: "uncaughtException",
      verdict: "exit",
      degraded: true,
    });
    expect(onFatal).toHaveBeenCalledWith("uncaughtException");
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(guards.snapshot()).toMatchObject({
      degraded: true,
      uncaughtExceptions: 1,
      unhandledRejections: 0,
    });
  });

  it("forces the exit when flushing the logger hangs past 2s", async () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const exit = vi.fn();
    const guards = createProcessGuards({
      logger: () => logger,
      exit,
      flush: () => new Promise<void>(() => undefined),
      flushTimeoutMs: 2_000,
    });

    const pending = guards.handleUncaughtException(new Error("flush hangs"));
    await vi.advanceTimersByTimeAsync(2_500);
    await pending;

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "process.guard", phase: "flush" }),
      "process.guard_flush_timeout",
    );
  });

  it("installs listeners once and removes them on uninstall", () => {
    const logger = createLogger();
    const guards = createProcessGuards({ logger: () => logger, exit: vi.fn() });
    const before = process.listenerCount("unhandledRejection");

    guards.install();
    guards.install();
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    expect(process.listenerCount("uncaughtException")).toBeGreaterThanOrEqual(1);

    guards.uninstall();
    expect(process.listenerCount("unhandledRejection")).toBe(before);
    expect(guards.isInstalled()).toBe(false);
  });

  it("handles a rejection emitted on the real process event", async () => {
    const logger = createLogger();
    const exit = vi.fn();
    const guards = createProcessGuards({ logger: () => logger, exit });
    guards.install();

    try {
      process.emit("unhandledRejection", new Error("event probe"), Promise.resolve());
      await vi.waitFor(() => {
        expect(logger.fatal).toHaveBeenCalledTimes(1);
      });
      expect(exit).not.toHaveBeenCalled();
    } finally {
      guards.uninstall();
    }
  });
});

describe("flushLogger", () => {
  it("resolves without a flush implementation", async () => {
    await expect(flushLogger({})).resolves.toBeUndefined();
  });

  it("calls a nested pino-like flush and respects its callback", async () => {
    const callbackSpy = vi.fn();
    const flush = vi.fn((callback: () => void) => {
      callbackSpy();
      callback();
    });

    await flushLogger({ logger: { flush } }, 100);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(callbackSpy).toHaveBeenCalledTimes(1);
  });
});