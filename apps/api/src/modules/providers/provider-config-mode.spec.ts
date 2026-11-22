import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_CONFIG_MODE,
  PROVIDER_CONFIG_MODE_ENV,
  normalizeProviderConfigMode,
  resolveProviderConfigMode,
} from "./provider-config-mode.js";

describe("provider config mode", () => {
  it("defaults to legacy when unset", () => {
    expect(DEFAULT_PROVIDER_CONFIG_MODE).toBe("legacy");
    expect(normalizeProviderConfigMode(undefined)).toBe("legacy");
    expect(resolveProviderConfigMode({})).toBe("legacy");
  });

  it("accepts every explicit mode case-insensitively", () => {
    expect(normalizeProviderConfigMode("legacy")).toBe("legacy");
    expect(normalizeProviderConfigMode(" shadow ")).toBe("shadow");
    expect(normalizeProviderConfigMode("V2")).toBe("v2");
    expect(resolveProviderConfigMode({ [PROVIDER_CONFIG_MODE_ENV]: "shadow" })).toBe("shadow");
  });

  it("fails fast on unknown values without reflecting secrets", () => {
    expect(() => normalizeProviderConfigMode("round_robin")).toThrow(
      /PROVIDER_CONFIG_MODE must be one of legacy, shadow, v2/,
    );
    expect(() => normalizeProviderConfigMode("sk-not-a-real-mode")).toThrow(
      /invalid value was not echoed/,
    );
  });
});
