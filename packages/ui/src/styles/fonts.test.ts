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
  it("ships the six frozen local pairings with CJK fallback and licenses", () => {
    expect(DEFAULT_FONT_PAIRING_ID).toBe("editorial-classic");
    expect(FONT_PAIRINGS.map((pairing) => pairing.id)).toEqual([
      "editorial-classic",
      "literary-warm",
      "modern-editorial",
      "expressive-serif",
      "cjk-editorial",
      "swiss-modern",
    ]);

    for (const pairing of FONT_PAIRINGS) {
      expect(pairing.displayStack).toMatch(/Noto Serif SC|Noto Sans SC|serif/);
      expect(pairing.bodyStack).toMatch(/Noto Sans SC|sans-serif/);
      expect(pairing.monoStack).toMatch(/mono/);
      expect(pairing.licenseId).toBe("OFL-1.1");
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
      expect(variables["--roamlog-font-serif"]).toContain(pairing.displayStack.split(",")[0]);
      expect(variables["--roamlog-font-sans"]).toContain(pairing.bodyStack.split(",")[0]);
      expect(variables["--roamlog-font-mono"]).toContain(pairing.monoStack.split(",")[0]);
    }
    expect(normalizeFontPairingId("literary-warm")).toBe("literary-warm");
    expect(normalizeFontPairingId("not-a-pairing")).toBe(DEFAULT_FONT_PAIRING_ID);
  });
});
