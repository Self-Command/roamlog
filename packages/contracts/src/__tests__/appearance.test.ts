import { describe, expect, it } from "vitest";

import {
  APPEARANCE_MODES,
  APPEARANCE_SOURCES,
  ACTIVE_FONT_PAIRING_IDS,
  ACTIVE_SKIN_IDS,
  AppearanceCookieSchema,
  AppearancePreferenceSchema,
  FONT_PAIRING_CATALOG,
  FONT_PAIRING_IDS,
  ResolvedAppearanceSchema,
  SKIN_CATALOG,
  SKIN_IDS,
  UpdateAppearancePreferenceSchema,
  normalizeFontPairingId,
  normalizeSkinId,
} from "../api/appearance";

describe("appearance contracts", () => {
  it("freezes the active enterprise choices with legacy IDs still parseable", () => {
    expect(APPEARANCE_MODES).toEqual(["system", "light", "dark"]);
    expect(ACTIVE_SKIN_IDS).toEqual([
      "mercury",
      "mist",
      "geist",
      "iris",
      "sandstone",
      "porcelain",
      "fluent",
      "carbon",
      "carbon-soft",
    ]);
    expect(ACTIVE_FONT_PAIRING_IDS).toEqual([
      "fluent-native",
      "primer-system",
      "primer-cjk",
      "carbon-plex",
    ]);
    expect(SKIN_IDS).toEqual([
      "mercury",
      "mist",
      "geist",
      "iris",
      "sandstone",
      "porcelain",
      "fluent",
      "carbon",
      "carbon-soft",
      "primer",
      "editorial-noir",
      "catppuccin",
      "tokyo-night",
      "rose-pine",
      "kanagawa",
      "everforest",
    ]);
    expect(FONT_PAIRING_IDS).toEqual([
      "fluent-native",
      "primer-system",
      "primer-cjk",
      "carbon-plex",
      "editorial-classic",
      "literary-warm",
      "modern-editorial",
      "expressive-serif",
      "cjk-editorial",
      "swiss-modern",
    ]);
  });

  it("keeps every catalog entry sourced, licensed and previewable", () => {
    expect(SKIN_CATALOG.map((entry) => entry.id)).toEqual(SKIN_IDS);
    expect(FONT_PAIRING_CATALOG.map((entry) => entry.id)).toEqual(FONT_PAIRING_IDS);

    for (const skin of SKIN_CATALOG) {
      expect(skin.sourceId.trim().length).toBeGreaterThan(0);
      expect(["MIT", "Apache-2.0", "internal"]).toContain(skin.licenseId);
      for (const preview of [skin.lightPreview, skin.darkPreview]) {
        expect(preview.canvas).toMatch(/^#[0-9a-f]{6}$/iu);
        expect(preview.ink).toMatch(/^#[0-9a-f]{6}$/iu);
        expect(preview.accent).toMatch(/^#[0-9a-f]{6}$/iu);
      }
    }

    for (const font of FONT_PAIRING_CATALOG) {
      expect(font.displayStack).toMatch(/serif|sans-serif|Segoe UI/iu);
      expect(font.bodyStack).toMatch(/sans-serif/iu);
      expect(font.monoStack).toMatch(/monospace/iu);
      expect(["OFL-1.1", "system"]).toContain(font.licenseId);
      expect(font.licenseSource).toMatch(/^https:\/\//u);
    }
  });

  it("normalizes every legacy ID to the enterprise catalog", () => {
    expect(normalizeSkinId("editorial-noir")).toBe("fluent");
    expect(normalizeSkinId("catppuccin")).toBe("fluent");
    expect(normalizeSkinId("tokyo-night")).toBe("carbon");
    expect(normalizeSkinId("kanagawa")).toBe("carbon-soft");
    expect(normalizeSkinId("mercury")).toBe("mercury");
    expect(normalizeSkinId("unknown")).toBe("mercury");
    expect(normalizeFontPairingId("editorial-classic")).toBe("fluent-native");
    expect(normalizeFontPairingId("cjk-editorial")).toBe("fluent-native");
    expect(normalizeFontPairingId("unknown")).toBe("fluent-native");
  });

  it("rejects an unknown cookie field without rejecting valid siblings", () => {
    const parsed = AppearanceCookieSchema.safeParse({
      v: 1,
      mode: "light",
      skin: "not-a-skin",
      fontPairing: "editorial-classic",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe("light");
      expect(parsed.data.skin).toBeUndefined();
      expect(parsed.data.fontPairing).toBe("editorial-classic");
    }
  });

  it("requires cookie version 1 and validates user cache metadata", () => {
    expect(AppearanceCookieSchema.safeParse({ v: 0 }).success).toBe(false);
    expect(AppearanceCookieSchema.safeParse({ v: 2 }).success).toBe(false);

    const parsed = AppearanceCookieSchema.parse({
      v: 1,
      uid: "01a1ed11-d7c2-74a3-98ba-3b9bd84b706a",
      updatedAt: "2026-11-22T12:00:00.000Z",
    });
    expect(parsed.uid).toBe("01a1ed11-d7c2-74a3-98ba-3b9bd84b706a");
    expect(parsed.updatedAt).toBe("2026-11-22T12:00:00.000Z");
  });

  it("represents inheritance with nulls and requires a non-empty partial update", () => {
    expect(
      AppearancePreferenceSchema.parse({
        mode: null,
        skin: "kanagawa",
        fontPairing: null,
      }),
    ).toEqual({ mode: null, skin: "kanagawa", fontPairing: null });

    expect(UpdateAppearancePreferenceSchema.parse({ mode: "light" })).toEqual({
      mode: "light",
    });
    expect(UpdateAppearancePreferenceSchema.parse({ mode: null })).toEqual({
      mode: null,
    });
    expect(UpdateAppearancePreferenceSchema.safeParse({}).success).toBe(false);
    expect(UpdateAppearancePreferenceSchema.safeParse({ skin: "not-a-skin" }).success).toBe(false);
  });

  it("resolves the complete appearance payload with platform defaults", () => {
    const parsed = ResolvedAppearanceSchema.parse({
      mode: "system",
      skin: "catppuccin",
      fontPairing: "literary-warm",
      source: "platform",
      canOverride: true,
      updatedAt: null,
      defaults: {
        mode: "system",
        skin: "mercury",
        fontPairing: "fluent-native",
      },
    });
    expect(APPEARANCE_SOURCES).toContain(parsed.source);
    expect(parsed.defaults.skin).toBe("mercury");
  });
});
