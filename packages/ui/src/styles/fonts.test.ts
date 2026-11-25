import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FONT_PAIRING_ID,
  FONT_PAIRINGS,
  fontPairingCssVariables,
  normalizeFontPairingId,
} from "./fonts";

describe("font pairing catalog", () => {
  it("ships the four enterprise pairings plus legacy compatibility entries", () => {
    expect(DEFAULT_FONT_PAIRING_ID).toBe("fluent-native");
    expect(FONT_PAIRINGS.map((pairing) => pairing.id)).toEqual([
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

    for (const pairing of FONT_PAIRINGS) {
      expect(pairing.displayStack).toMatch(/Noto Sans SC|Noto Serif SC|Segoe UI|serif/);
      expect(pairing.bodyStack).toMatch(/Noto Sans SC|sans-serif/);
      expect(pairing.monoStack).toMatch(/mono/);
      expect(["OFL-1.1", "system"]).toContain(pairing.licenseId);
      expect(pairing.licenseFile).toMatch(/^font-licenses\/.+\.txt$/);
      expect(existsSync(resolve(__dirname, pairing.licenseFile))).toBe(true);
    }
  });

  it("never references remote font URLs", () => {
    for (const pairing of FONT_PAIRINGS) {
      expect(`${pairing.displayStack}${pairing.bodyStack}${pairing.monoStack}`).not.toMatch(
        /https?:\/\//,
      );
    }
  });

  it("resolves CSS variables for each pairing", () => {
    for (const pairing of FONT_PAIRINGS) {
      const variables = fontPairingCssVariables(pairing.id);
      expect(variables["--roamlog-font-display"]).toContain(
        pairing.displayStack.split(",")[0],
      );
      expect(variables["--roamlog-font-ui"]).toContain(pairing.bodyStack.split(",")[0]);
      expect(variables["--roamlog-font-prose"]).toMatch(/serif/u);
      expect(variables["--roamlog-font-mono"]).toContain(pairing.monoStack.split(",")[0]);
    }
    expect(normalizeFontPairingId("literary-warm")).toBe("fluent-native");
    expect(normalizeFontPairingId("cjk-editorial")).toBe("fluent-native");
    expect(normalizeFontPairingId("carbon-plex")).toBe("carbon-plex");
    expect(normalizeFontPairingId("not-a-pairing")).toBe(DEFAULT_FONT_PAIRING_ID);
  });
});
