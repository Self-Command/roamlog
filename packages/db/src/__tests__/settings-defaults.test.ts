import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  defaultSettingKeys,
  defaultSettingsSnapshot,
  hasDefaultSetting,
} from "../settings-defaults.js";

describe("DEFAULT_SETTINGS", () => {
  it("covers every first-release setting group", () => {
    const keys = defaultSettingKeys();
    for (const prefix of [
      "site.",
      "general.",
      "seo.",
      "theme.",
      "mail.",
      "storage.",
      "media.",
      "ai.",
      "places.",
      "limits.",
    ]) {
      expect(
        keys.some((key) => key.startsWith(prefix)),
        `missing ${prefix} key`,
      ).toBe(true);
    }
  });

  it("keeps secret defaults unset instead of inventing placeholder credentials", () => {
    for (const key of [
      "mail.resendApiKey",
      "mail.smtpPassword",
      "storage.accessKey",
      "storage.secretKey",
      "places.apiKey",
      "ai.apiKey",
    ]) {
      expect(DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]).toBeNull();
    }
  });

  it("starts the console-configurable AI provider keys unset", () => {
    for (const key of ["ai.baseUrl", "ai.model", "ai.apiKey"]) {
      expect(hasDefaultSetting(key), key).toBe(true);
      expect(DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS], key).toBeNull();
    }
  });

  it("is frozen so a caller cannot mutate the shared baseline", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(() => {
      (DEFAULT_SETTINGS as unknown as Record<string, unknown>)["site.title"] = "hacked";
    }).toThrow();
    expect(DEFAULT_SETTINGS["site.title"]).toBe("Roamlog");
  });

  it("hands out a detached snapshot and answers key predicates", () => {
    const snapshot = defaultSettingsSnapshot();
    snapshot["site.title"] = "local change";
    expect(DEFAULT_SETTINGS["site.title"]).toBe("Roamlog");
    expect(hasDefaultSetting("media.maxEdge")).toBe(true);
    expect(hasDefaultSetting("nope.nope")).toBe(false);
  });
});
