import { describe, expect, it } from "vitest";

import {
  checkFallbackOccurred,
  computeFallbackScore,
  fallbackPenalty,
  requestedLayers,
} from "../ranking/pelias-fallback.js";

/**
 * Upstream fixture reuse from
 * `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/test/unit/middleware/confidenceScoreFallback.js`.
 * Expected `confidence` and `match_type` values are copied from those cases.
 */
describe("pelias-fallback (upstream fixtures)", () => {
  it("no parsed_text scores 0.1 / match_type=unknown", () => {
    expect(computeFallbackScore(undefined, "locality")).toEqual({
      confidence: 0.1,
      matchType: "unknown",
    });
  });

  it("an exact address is 1.0 / exact", () => {
    expect(
      computeFallbackScore(
        { housenumber: 123, street: "Main St", city: "City", state: "NM" },
        "address",
      ),
    ).toEqual({ confidence: 1, matchType: "exact" });
  });

  it("address query falling back to locality is 0.6 / fallback", () => {
    expect(
      computeFallbackScore({ housenumber: 123, street: "Main St", state: "NM" }, "locality"),
    ).toEqual({ confidence: 0.6, matchType: "fallback" });
  });

  it("address query falling back to localadmin is 0.6 / fallback", () => {
    expect(
      computeFallbackScore({ housenumber: 123, street: "Main St", state: "NM" }, "localadmin"),
    ).toEqual({ confidence: 0.6, matchType: "fallback" });
  });

  it("address query falling back to country is 0.1 / fallback", () => {
    expect(
      computeFallbackScore(
        { housenumber: 123, street: "Main St", state: "NM", country: "USA" },
        "country",
      ),
    ).toEqual({ confidence: 0.1, matchType: "fallback" });
  });

  it("city query matching locality is exact 1.0", () => {
    expect(computeFallbackScore({ city: "city name", state: "state name" }, "locality")).toEqual({
      confidence: 1,
      matchType: "exact",
    });
  });

  it("city query matching localadmin is exact 1.0", () => {
    expect(computeFallbackScore({ city: "city name", state: "state name" }, "localadmin")).toEqual({
      confidence: 1,
      matchType: "exact",
    });
  });

  it("city query falling back to region is 0.3", () => {
    expect(computeFallbackScore({ city: "city name", state: "state name" }, "region")).toEqual({
      confidence: 0.3,
      matchType: "fallback",
    });
  });

  it("city query falling back to country is 0.1", () => {
    expect(
      computeFallbackScore({ city: "city name", state: "state name", country: "country name" }, "country"),
    ).toEqual({ confidence: 0.1, matchType: "fallback" });
  });

  it("address query falling back to postalcode is 0.8", () => {
    expect(
      computeFallbackScore(
        {
          housenumber: 123,
          street: "Main St",
          state: "NM",
          country: "USA",
          postalcode: "1234",
        },
        "postalcode",
      ),
    ).toEqual({ confidence: 0.8, matchType: "fallback" });
  });

  it("postalcode+country query matching postalcode is exact 1.0", () => {
    expect(computeFallbackScore({ country: "USA", postalcode: "1234" }, "postalcode")).toEqual({
      confidence: 1,
      matchType: "exact",
    });
  });

  it("exposes the exact penalty table from confidenceScoreFallback.js:68-105", () => {
    expect(fallbackPenalty("venue")).toBe(0.8);
    expect(fallbackPenalty("address")).toBe(0.8);
    expect(fallbackPenalty("street")).toBe(0.8);
    expect(fallbackPenalty("postalcode")).toBe(0.8);
    expect(fallbackPenalty("localadmin")).toBe(0.6);
    expect(fallbackPenalty("locality")).toBe(0.6);
    expect(fallbackPenalty("borough")).toBe(0.6);
    expect(fallbackPenalty("neighbourhood")).toBe(0.6);
    expect(fallbackPenalty("macrocounty")).toBe(0.4);
    expect(fallbackPenalty("county")).toBe(0.4);
    expect(fallbackPenalty("region")).toBe(0.3);
    expect(fallbackPenalty("country")).toBe(0.1);
    expect(fallbackPenalty("dependency")).toBe(0.1);
    expect(fallbackPenalty("macroregion")).toBe(0.1);
    expect(fallbackPenalty("unknown-layer")).toBe(0.1);
  });

  it("requestedLayers returns the city rule's expected layers", () => {
    expect(requestedLayers({ city: "北京" })).toEqual(["borough", "locality", "localadmin"]);
    expect(requestedLayers({ housenumber: "87号", street: "建国路" })).toEqual(["address"]);
    expect(requestedLayers(undefined)).toEqual([]);
  });

  it("checkFallbackOccurred is false when the layer matches the rule", () => {
    expect(checkFallbackOccurred({ city: "北京" }, "locality")).toBe(false);
    expect(checkFallbackOccurred({ city: "北京" }, "venue")).toBe(true);
  });
});
