/**
 * UPLOAD_LIMITS_WIRED — the three configurable upload ceilings.
 *
 * The admin console renders anything the registry declares, but "visible in the
 * form" is not "wired at runtime": these tests pin the defaults the presign
 * pipeline falls back to, the per-key range each stored row must satisfy, the
 * database-over-default priority, the environment fallback and the envLocked
 * rule that keeps a locked deployment from losing to a stale row.
 */

import { DEFAULT_SETTINGS } from "@roamlog/db";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_UPLOAD_MAX_BATCH_BYTES,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  DEFAULT_UPLOAD_MAX_FILES_PER_BATCH,
  LIMITS_ENV_VARS,
  LIMITS_SETTING_KEYS,
  type StoredLimitSetting,
  resolveLimitsSettingsFromStored,
} from "../limits-settings.consumer.js";
import { SETTINGS_BY_KEY } from "../settings.registry.js";

const UPLOAD_KEYS = [
  "limits.uploadMaxFilesPerBatch",
  "limits.uploadMaxFileBytes",
  "limits.uploadMaxBatchBytes",
] as const;

function stored(key: string, value: unknown, hasRow = true): StoredLimitSetting {
  return { key, value, updatedAt: hasRow ? "2026-11-19T00:00:00.000Z" : null };
}

const DEFAULT_RUNTIME = {
  searchPerMinute: 30,
  uploadPerMinute: 20,
  uploadMaxFilesPerBatch: DEFAULT_UPLOAD_MAX_FILES_PER_BATCH,
  uploadMaxFileBytes: DEFAULT_UPLOAD_MAX_FILE_BYTES,
  uploadMaxBatchBytes: DEFAULT_UPLOAD_MAX_BATCH_BYTES,
};

describe("upload ceiling settings", () => {
  it("registers all three in the limits group, private and not env-locked", () => {
    for (const key of UPLOAD_KEYS) {
      expect(LIMITS_SETTING_KEYS, key).toContain(key);
    }

    for (const key of UPLOAD_KEYS) {
      const definition = SETTINGS_BY_KEY.get(key);
      expect(definition, key).toBeDefined();
      expect(definition!.group, key).toBe("limits");
      expect(definition!.type, key).toBe("number");
      // Ops configuration: never exposed through the anonymous settings endpoint.
      expect(definition!.isPublic, key).toBe(false);
      expect(definition!.isSecret, key).toBe(false);
      expect(definition!.envLocked, key).toBe(false);
      expect(definition!.label.length, key).toBeGreaterThan(0);
      expect(definition!.help.length, key).toBeGreaterThan(0);
    }
  });

  it("uses 20 files / 25 MiB / 150 MiB as both registry default and code default", () => {
    expect(DEFAULT_SETTINGS["limits.uploadMaxFilesPerBatch"]).toBe(20);
    expect(DEFAULT_SETTINGS["limits.uploadMaxFileBytes"]).toBe(26_214_400);
    expect(DEFAULT_SETTINGS["limits.uploadMaxBatchBytes"]).toBe(157_286_400);

    expect(DEFAULT_UPLOAD_MAX_FILES_PER_BATCH).toBe(20);
    expect(DEFAULT_UPLOAD_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(DEFAULT_UPLOAD_MAX_BATCH_BYTES).toBe(150 * 1024 * 1024);
  });

  it("accepts the range boundaries and rejects anything outside them", () => {
    const cases: ReadonlyArray<readonly [string, number, number]> = [
      ["limits.uploadMaxFilesPerBatch", 1, 100],
      ["limits.uploadMaxFileBytes", 1, 104_857_600],
      ["limits.uploadMaxBatchBytes", 1, 1_073_741_824],
    ];
    for (const [key, min, max] of cases) {
      const schema = SETTINGS_BY_KEY.get(key)!.schema;
      expect(schema.safeParse(min).success, `${key} min`).toBe(true);
      expect(schema.safeParse(max).success, `${key} max`).toBe(true);
      expect(schema.safeParse(min - 1).success, `${key} below min`).toBe(false);
      expect(schema.safeParse(max + 1).success, `${key} above max`).toBe(false);
      expect(schema.safeParse(1.5).success, `${key} non-integer`).toBe(false);
      expect(schema.safeParse(String(max)).success, `${key} string`).toBe(false);
    }
  });

  it("falls back to the code defaults when nothing is stored or configured", () => {
    const { runtime, ignored } = resolveLimitsSettingsFromStored({ env: {} });
    expect(runtime).toEqual(DEFAULT_RUNTIME);
    expect(ignored).toEqual([]);
  });

  it("lets a stored database row win over the defaults, per key", () => {
    const { runtime, ignored } = resolveLimitsSettingsFromStored({
      env: {},
      stored: [
        stored("limits.uploadMaxFilesPerBatch", 7),
        stored("limits.uploadMaxFileBytes", 1_048_576),
        stored("limits.uploadMaxBatchBytes", 20_971_520),
      ],
    });

    expect(runtime.uploadMaxFilesPerBatch).toBe(7);
    expect(runtime.uploadMaxFileBytes).toBe(1_048_576);
    expect(runtime.uploadMaxBatchBytes).toBe(20_971_520);
    expect(ignored).toEqual([]);
  });

  it("ignores an out-of-range stored row and reports it instead of clamping", () => {
    const { runtime, ignored } = resolveLimitsSettingsFromStored({
      env: {},
      stored: [
        stored("limits.uploadMaxFilesPerBatch", 0),
        stored("limits.uploadMaxFileBytes", 104_857_601),
        stored("limits.uploadMaxBatchBytes", -5),
      ],
    });

    expect(runtime).toEqual(DEFAULT_RUNTIME);
    expect(ignored.map((entry) => entry.key).sort()).toEqual([...UPLOAD_KEYS].sort());
  });

  it("never lets a stored row beat a locked key", () => {
    const locked = new Map<string, { envLocked: boolean; envVar?: string }>([
      ["limits.uploadMaxFileBytes", { envLocked: true, envVar: "MEDIA_UPLOAD_MAX_FILE_BYTES" }],
    ]);

    const { runtime } = resolveLimitsSettingsFromStored({
      env: { MEDIA_UPLOAD_MAX_FILE_BYTES: "5242880" },
      envLockOf: (key) => locked.get(key),
      stored: [stored("limits.uploadMaxFileBytes", 1_048_576)],
    });

    expect(runtime.uploadMaxFileBytes).toBe(5_242_880);
  });

  it("uses the MEDIA_UPLOAD_* environment fallbacks when no row exists", () => {
    expect(LIMITS_ENV_VARS["limits.uploadMaxFilesPerBatch"]).toBe(
      "MEDIA_UPLOAD_MAX_FILES_PER_BATCH",
    );
    expect(LIMITS_ENV_VARS["limits.uploadMaxFileBytes"]).toBe("MEDIA_UPLOAD_MAX_FILE_BYTES");
    expect(LIMITS_ENV_VARS["limits.uploadMaxBatchBytes"]).toBe("MEDIA_UPLOAD_MAX_BATCH_BYTES");

    const { runtime } = resolveLimitsSettingsFromStored({
      env: {
        MEDIA_UPLOAD_MAX_FILES_PER_BATCH: "40",
        MEDIA_UPLOAD_MAX_FILE_BYTES: "52428800",
        MEDIA_UPLOAD_MAX_BATCH_BYTES: "314572800",
      },
      // `listAdminSettings()` hands back the registry default with
      // `updatedAt: null` when no row exists; that must not beat the env.
      stored: [
        stored("limits.uploadMaxFilesPerBatch", 20, false),
        stored("limits.uploadMaxFileBytes", 26_214_400, false),
        stored("limits.uploadMaxBatchBytes", 157_286_400, false),
      ],
    });

    expect(runtime).toEqual({
      searchPerMinute: 30,
      uploadPerMinute: 20,
      uploadMaxFilesPerBatch: 40,
      uploadMaxFileBytes: 52_428_800,
      uploadMaxBatchBytes: 314_572_800,
    });
  });

  it("drops an env value the deployment range cannot express", () => {
    const { runtime } = resolveLimitsSettingsFromStored({
      env: { MEDIA_UPLOAD_MAX_FILES_PER_BATCH: "not-a-number" },
    });
    expect(runtime.uploadMaxFilesPerBatch).toBe(DEFAULT_UPLOAD_MAX_FILES_PER_BATCH);
  });

  it("re-reads settings on every resolve so an admin save applies immediately", async () => {
    const { LimitsSettingsResolver } = await import("../limits-settings.consumer.js");
    const settings = {
      listAdminSettings: vi.fn(async () => ({
        groups: [
          {
            group: "limits",
            label: "limits",
            items: [
              { key: "limits.uploadMaxFileBytes", value: 1_048_576, updatedAt: "2026-11-19" },
            ],
          },
        ],
        generatedAt: "2026-11-19T00:00:00.000Z",
      })),
    };
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const resolver = new LimitsSettingsResolver(settings as never, logger as never);

    await expect(resolver.resolve()).resolves.toMatchObject({ uploadMaxFileBytes: 1_048_576 });
    settings.listAdminSettings.mockResolvedValueOnce({
      groups: [
        {
          group: "limits",
          label: "limits",
          items: [
            { key: "limits.uploadMaxFileBytes", value: 2_097_152, updatedAt: "2026-11-19" },
          ],
        },
      ],
      generatedAt: "2026-11-19T00:00:01.000Z",
    });
    await expect(resolver.resolve()).resolves.toMatchObject({ uploadMaxFileBytes: 2_097_152 });
  });
});