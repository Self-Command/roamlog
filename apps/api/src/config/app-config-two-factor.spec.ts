import { describe, expect, it, vi } from "vitest";

import { AppConfigService } from "./app-config.service.js";

describe("ADMIN_2FA_ENFORCED configuration", () => {
  function configWith(values: Record<string, unknown>): AppConfigService {
    const config = {
      get: vi.fn((key: string) => values[key]),
    };
    return new AppConfigService(config as never);
  }

  it("defaults to enabled in production", () => {
    expect(configWith({ NODE_ENV: "production" }).adminTwoFactorEnforced).toBe(true);
  });

  it("defaults to disabled outside production", () => {
    expect(configWith({ NODE_ENV: "development" }).adminTwoFactorEnforced).toBe(false);
  });

  it("honors an explicit environment override", () => {
    expect(
      configWith({
        NODE_ENV: "production",
        ADMIN_2FA_ENFORCED: false,
      }).adminTwoFactorEnforced,
    ).toBe(false);
    expect(
      configWith({
        NODE_ENV: "development",
        ADMIN_2FA_ENFORCED: true,
      }).adminTwoFactorEnforced,
    ).toBe(true);
  });
});
