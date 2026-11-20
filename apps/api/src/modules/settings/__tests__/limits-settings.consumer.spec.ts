import type { AdminSettingItem, AdminSettingsResponse } from "@roamlog/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { SettingsService } from "../settings.service.js";
import {
  DEFAULT_SEARCH_PER_MINUTE,
  DEFAULT_UPLOAD_PER_MINUTE,
  LimitsSettingsResolver,
  resolveLimitsSettingsFromStored,
  type StoredLimitSetting,
} from "../limits-settings.consumer.js";

function stored(key: string, value: unknown, hasRow = true): StoredLimitSetting {
  return { key, value, updatedAt: hasRow ? "2026-11-19T00:00:00.000Z" : null };
}

/**
 * UPLOAD_LIMITS_WIRED added the three upload ceilings to the runtime object, so
 * every assertion over the whole snapshot has to carry them. They have their own
 * spec (`upload-limits.consumer.spec.ts`); here they are only kept honest.
 */
const UPLOAD_DEFAULTS = {
  uploadMaxFilesPerBatch: 20,
  uploadMaxFileBytes: 26_214_400,
  uploadMaxBatchBytes: 157_286_400,
} as const;

function runtimeOf(values: { searchPerMinute: number; uploadPerMinute: number }) {
  return { ...values, ...UPLOAD_DEFAULTS };
}

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeResolver(
  items: readonly StoredLimitSetting[],
  logger = makeLogger(),
): { resolver: LimitsSettingsResolver; logger: ReturnType<typeof makeLogger> } {
  const settings = {
    listAdminSettings: vi.fn(
      async () =>
        ({
          groups: [
            { group: "limits", label: "limits", items: items as unknown as AdminSettingItem[] },
          ],
          generatedAt: "2026-11-19T00:00:00.000Z",
        }) as unknown as AdminSettingsResponse,
    ),
  } as unknown as SettingsService;
  return {
    resolver: new LimitsSettingsResolver(settings, logger as unknown as PinoLoggerService),
    logger,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // The resolver reads `process.env`; pin the legacy fallbacks to "unset" so a
  // developer shell or `.env.test` cannot change the expected defaults.
  vi.stubEnv("PLACES_RATE_LIMIT_MAX", "");
  vi.stubEnv("MEDIA_PRESIGN_RATE_LIMIT_MAX", "");
  vi.stubEnv("MEDIA_UPLOAD_MAX_FILES_PER_BATCH", "");
  vi.stubEnv("MEDIA_UPLOAD_MAX_FILE_BYTES", "");
  vi.stubEnv("MEDIA_UPLOAD_MAX_BATCH_BYTES", "");
});

describe("resolveLimitsSettingsFromStored", () => {
  it("lets a stored row win over the environment", () => {
    const { runtime } = resolveLimitsSettingsFromStored({
      env: { PLACES_RATE_LIMIT_MAX: "100", MEDIA_PRESIGN_RATE_LIMIT_MAX: "50" },
      stored: [
        stored("limits.searchPerMinute", 3),
        stored("limits.uploadPerMinute", 4),
      ],
    });

    expect(runtime).toEqual(runtimeOf({ searchPerMinute: 3, uploadPerMinute: 4 }));
  });

  it("falls back to the environment when there is no database row", () => {
    const { runtime } = resolveLimitsSettingsFromStored({
      env: { PLACES_RATE_LIMIT_MAX: "7", MEDIA_PRESIGN_RATE_LIMIT_MAX: "9" },
      // `listAdminSettings()` returns the registry default with `updatedAt: null`
      // when no row exists; that must not beat the environment.
      stored: [
        stored("limits.searchPerMinute", DEFAULT_SEARCH_PER_MINUTE, false),
        stored("limits.uploadPerMinute", 10, false),
      ],
    });

    expect(runtime).toEqual(runtimeOf({ searchPerMinute: 7, uploadPerMinute: 9 }));
  });

  it("uses the legacy code constants when neither layer is configured", () => {
    const { runtime } = resolveLimitsSettingsFromStored({ env: {}, stored: [] });

    expect(runtime).toEqual(
      runtimeOf({
        searchPerMinute: DEFAULT_SEARCH_PER_MINUTE,
        uploadPerMinute: DEFAULT_UPLOAD_PER_MINUTE,
      }),
    );
  });

  it("lets an env-locked key win over the stored row", () => {
    const { runtime } = resolveLimitsSettingsFromStored({
      env: { PLACES_RATE_LIMIT_MAX: "12" },
      stored: [stored("limits.searchPerMinute", 3)],
      envLockOf: (key) =>
        key === "limits.searchPerMinute"
          ? { envLocked: true, envVar: "PLACES_RATE_LIMIT_MAX" }
          : undefined,
    });

    expect(runtime.searchPerMinute).toBe(12);
  });

  it("rejects out-of-contract stored values and reports them instead of throwing", () => {
    for (const value of [0, -1, 601, 2.5, "10", null]) {
      const { runtime, ignored } = resolveLimitsSettingsFromStored({
        env: {},
        stored: [stored("limits.searchPerMinute", value)],
      });

      expect(runtime.searchPerMinute).toBe(DEFAULT_SEARCH_PER_MINUTE);
      expect(ignored).toEqual([{ key: "limits.searchPerMinute", reason: "unsupported_value" }]);
    }
  });

  it("falls back per key: a bad search row does not discard a good upload row", () => {
    const { runtime, ignored } = resolveLimitsSettingsFromStored({
      env: { PLACES_RATE_LIMIT_MAX: "8" },
      stored: [stored("limits.searchPerMinute", 9999), stored("limits.uploadPerMinute", 5)],
    });

    expect(runtime).toEqual(runtimeOf({ searchPerMinute: 8, uploadPerMinute: 5 }));
    expect(ignored).toHaveLength(1);
  });
});

describe("LimitsSettingsResolver", () => {
  it("resolves a stored row over the environment", async () => {
    vi.stubEnv("PLACES_RATE_LIMIT_MAX", "100");
    vi.stubEnv("MEDIA_PRESIGN_RATE_LIMIT_MAX", "50");
    const { resolver } = makeResolver([
      stored("limits.searchPerMinute", 3),
      stored("limits.uploadPerMinute", 4),
    ]);

    await expect(resolver.resolve()).resolves.toEqual(
      runtimeOf({ searchPerMinute: 3, uploadPerMinute: 4 }),
    );
  });

  it("re-reads the settings on every resolve so a save applies immediately", async () => {
    const source = makeResolver([stored("limits.searchPerMinute", 2)]);
    await expect(source.resolver.resolve()).resolves.toMatchObject({ searchPerMinute: 2 });

    const changed = makeResolver([stored("limits.searchPerMinute", 30)]);
    await expect(changed.resolver.resolve()).resolves.toMatchObject({ searchPerMinute: 30 });
  });

  it("warns once (10s throttle) about invalid stored values and falls back", async () => {
    const { resolver, logger } = makeResolver([
      stored("limits.searchPerMinute", 0),
      stored("limits.uploadPerMinute", 601),
    ]);

    await expect(resolver.resolve()).resolves.toEqual(
      runtimeOf({
        searchPerMinute: DEFAULT_SEARCH_PER_MINUTE,
        uploadPerMinute: DEFAULT_UPLOAD_PER_MINUTE,
      }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "limits.setting_value_ignored" }),
      "limits.setting_value_ignored",
    );
  });

  it("falls back to the environment and warns when the database is unavailable", async () => {
    vi.stubEnv("PLACES_RATE_LIMIT_MAX", "6");
    const logger = makeLogger();
    const settings = {
      listAdminSettings: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    } as unknown as SettingsService;
    const resolver = new LimitsSettingsResolver(
      settings,
      logger as unknown as PinoLoggerService,
    );

    await expect(resolver.resolve()).resolves.toEqual(
      runtimeOf({ searchPerMinute: 6, uploadPerMinute: DEFAULT_UPLOAD_PER_MINUTE }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "limits.settings_unavailable" }),
      "limits.settings_unavailable",
    );
  });

  it("never throws when the settings read fails and the environment is empty", async () => {
    const settings = {
      listAdminSettings: vi.fn(async () => {
        throw new Error("db down");
      }),
    } as unknown as SettingsService;
    const resolver = new LimitsSettingsResolver(
      settings,
      makeLogger() as unknown as PinoLoggerService,
    );

    await expect(resolver.resolve()).resolves.toEqual(
      runtimeOf({
        searchPerMinute: DEFAULT_SEARCH_PER_MINUTE,
        uploadPerMinute: DEFAULT_UPLOAD_PER_MINUTE,
      }),
    );
  });
});