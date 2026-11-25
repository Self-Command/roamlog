import { describe, expect, it, vi } from "vitest";

import type { AppearanceCookie } from "@roamlog/contracts";

import {
  encodeAppearanceCookie,
  parseAppearanceCookie,
  readCookieValue,
  resolveAppearanceForRequest,
  resolveAppearanceFromRequest,
  resolveLegacyAccentSkin,
  themeColorsForSkin,
} from "./appearance";
import { resolveThemePresentation } from "./settings";

const PLATFORM = {
  mode: "system" as const,
  skin: "fluent" as const,
  fontPairing: "fluent-native" as const,
};

describe("resolveAppearanceForRequest", () => {
  it("never lets a stale cookie beat the signed-in DB preference", () => {
    const resolved = resolveAppearanceForRequest({
      db: {
        mode: "light",
        skin: "everforest",
        fontPairing: "literary-warm",
        updatedAt: "2026-11-22T12:00:00.000Z",
      },
      cookie: {
        v: 1,
        uid: "0199a0c1-1100-7000-8000-000000000001",
        updatedAt: "2026-11-21T12:00:00.000Z",
        mode: "dark",
      },
      platform: PLATFORM,
      canOverride: true,
    });

    expect(resolved).toMatchObject({
      mode: "light",
      skin: "carbon-soft",
      fontPairing: "fluent-native",
      source: "user",
    });
    expect(resolved.defaults).toEqual(PLATFORM);
  });

  it("falls field-by-field to platform defaults", () => {
    const resolved = resolveAppearanceForRequest({
      db: null,
      cookie: { v: 1, mode: "dark", skin: "not-a-skin" as never },
      platform: {
        mode: "system",
        skin: "catppuccin",
        fontPairing: "swiss-modern",
      },
      canOverride: true,
    });

    expect(resolved).toMatchObject({
      mode: "dark",
      skin: "fluent",
      fontPairing: "fluent-native",
      source: "cookie",
    });
  });

  it("ignores user and cookie choices when overrides are disabled", () => {
    const resolved = resolveAppearanceForRequest({
      db: { mode: "dark", skin: "rose-pine", fontPairing: "expressive-serif" },
      cookie: { v: 1, mode: "light" },
      platform: PLATFORM,
      canOverride: false,
    });

    expect(resolved).toMatchObject({
      ...PLATFORM,
      source: "platform",
      canOverride: false,
    });
  });

  it("rejects a cookie belonging to a different user", () => {
    const resolved = resolveAppearanceForRequest({
      db: null,
      cookie: {
        v: 1,
        uid: "0199a0c1-1100-7000-8000-000000000001",
        mode: "dark",
      },
      userId: "0199a0c1-1100-7000-8000-000000000002",
      platform: PLATFORM,
      canOverride: true,
    });

    expect(resolved).toMatchObject(PLATFORM);
    expect(resolved.source).toBe("platform");
  });
});

describe("appearance cookie codec", () => {
  it("round-trips URI-encoded and raw JSON values", () => {
    const cookie: AppearanceCookie = {
      v: 1,
      mode: "light",
      skin: "fluent",
      fontPairing: "primer-cjk",
      updatedAt: "2026-11-22T12:00:00.000Z",
    };
    const encoded = encodeAppearanceCookie(cookie);

    expect(parseAppearanceCookie(encoded)).toEqual(cookie);
    expect(parseAppearanceCookie(JSON.stringify(cookie))).toEqual(cookie);
    expect(readCookieValue(`a=1; roamlog_appearance=${encoded}; b=2`, "roamlog_appearance")).toBe(
      encoded,
    );
  });

  it("drops an unknown field while preserving valid siblings", () => {
    const parsed = parseAppearanceCookie(
      JSON.stringify({
        v: 1,
        mode: "light",
        skin: "not-a-skin",
        fontPairing: "swiss-modern",
      }),
    );

    expect(parsed).toMatchObject({
      v: 1,
      mode: "light",
      fontPairing: "fluent-native",
    });
    expect(parsed?.skin).toBeUndefined();
  });
});

describe("appearance presentation helpers", () => {
  it("maps legacy accents and exposes both skin canvases", () => {
    expect(resolveLegacyAccentSkin("rose")).toBe("porcelain");
    expect(themeColorsForSkin("fluent")).toEqual({
      light: "#ffffff",
      dark: "#292929",
    });
  });

  it("passes a resolved user appearance into the theme presentation", () => {
    const presentation = resolveThemePresentation(
      {
        "theme.defaultMode": "system",
        "theme.defaultSkin": "editorial-noir",
        "theme.defaultFont": "editorial-classic",
      },
      { mode: "light", skin: "catppuccin", fontPairing: "modern-editorial" },
    );

    expect(presentation).toMatchObject({
      mode: "light",
      dataTheme: "light",
      dataSkin: "fluent",
      dataFont: "fluent-native",
      colorScheme: "light",
    });
  });
});

describe("resolveAppearanceFromRequest", () => {
  const settings = {
    "theme.defaultMode": "system" as const,
    "theme.defaultSkin": "fluent" as const,
    "theme.defaultFont": "fluent-native" as const,
    "theme.allowUserOverride": true,
  };
  const cookie = encodeAppearanceCookie({
    v: 1,
    mode: "dark",
    updatedAt: "2026-11-21T12:00:00.000Z",
  });
  const sessionCookie = `roamlog.session_token=session; roamlog_appearance=${cookie}`;

  it("uses the authenticated API response and forwards the request cookies", async () => {
    const fetcher = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            mode: "light",
            skin: "everforest",
            fontPairing: "literary-warm",
            source: "user",
            canOverride: true,
            updatedAt: "2026-11-22T12:00:00.000Z",
            defaults: PLATFORM,
          }),
        }) as Response,
    );

    await expect(
      resolveAppearanceFromRequest(settings, sessionCookie, { fetcher }),
    ).resolves.toMatchObject({
      mode: "light",
      skin: "carbon-soft",
      source: "user",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:4000/v1/me/appearance",
      expect.objectContaining({
        headers: expect.objectContaining({ cookie: sessionCookie }),
      }),
    );
  });

  it("falls back to the appearance cookie when the API is unavailable", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(
      resolveAppearanceFromRequest(settings, sessionCookie, { fetcher }),
    ).resolves.toMatchObject({
      mode: "dark",
      skin: "fluent",
      source: "cookie",
    });
  });

  it("does not call the API for a guest", async () => {
    const fetcher = vi.fn();

    await expect(
      resolveAppearanceFromRequest(settings, `roamlog_appearance=${cookie}`, { fetcher }),
    ).resolves.toMatchObject({ mode: "dark", source: "cookie" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
