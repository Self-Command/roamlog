import { afterEach, describe, expect, it, vi } from "vitest";

import { createProcessGuards } from "../../../common/process-guards.js";
import { MetricsService } from "../metrics.service.js";

function createLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("process guard metrics", () => {
  it("reports zero when no guard is installed", async () => {
    const metrics = new MetricsService();
    const output = await metrics.render();

    expect(output).toContain("roamlog_unhandled_rejections_total 0");
    expect(output).toContain("roamlog_uncaught_exceptions_total 0");
    expect(output).toContain("roamlog_process_degraded 0");
  });

  it("surfaces unhandled rejections and degraded state on scrape", async () => {
    const metrics = new MetricsService();
    const guards = createProcessGuards({
      logger: () => createLogger(),
      exit: vi.fn(),
      now: () => 1_000,
    });
    guards.install();

    try {
      await guards.handleUnhandledRejection(new Error("metrics probe"));

      const output = await metrics.render();
      expect(output).toContain("roamlog_unhandled_rejections_total 1");
      expect(output).toContain("roamlog_uncaught_exceptions_total 0");
      expect(output).toContain("roamlog_process_degraded 1");
    } finally {
      guards.uninstall();
    }

    const cleared = await metrics.render();
    expect(cleared).toContain("roamlog_unhandled_rejections_total 0");
    expect(cleared).toContain("roamlog_process_degraded 0");
  });

  it("counts uncaught exceptions", async () => {
    const metrics = new MetricsService();
    const guards = createProcessGuards({
      logger: () => createLogger(),
      exit: vi.fn(),
      flush: async () => undefined,
    });
    guards.install();

    try {
      await guards.handleUncaughtException(new Error("fatal metrics probe"));

      const output = await metrics.render();
      expect(output).toContain("roamlog_uncaught_exceptions_total 1");
      expect(output).toContain("roamlog_process_degraded 1");
    } finally {
      guards.uninstall();
    }
  });
});