import { describe, expect, it } from "vitest";

import {
  SOURCE_PREFERENCE,
  dedupeDocuments,
  isDifferent,
  isPreferred,
  layerPreferences,
  type PeliasDedupeDocument,
} from "../ranking/pelias-dedupe.js";

function document(overrides: Record<string, unknown>): PeliasDedupeDocument {
  return {
    source: "photon",
    layer: "locality",
    name: { default: "Paris" },
    parent: { country_id: ["photon:country:france"], country_a: ["FR"] },
    address_parts: {},
    ...overrides,
  } as PeliasDedupeDocument;
}

describe("pelias-dedupe", () => {
  it("uses the Pelias layer preference list", () => {
    expect(layerPreferences).toEqual([
      "country",
      "locality",
      "localadmin",
      "county",
      "region",
      "neighbourhood",
      "macrocounty",
      "macroregion",
      "empire",
    ]);
  });

  it("defines the Roamlog source preference (spec §5.8)", () => {
    expect(SOURCE_PREFERENCE.tencent ?? 99).toBeLessThan(SOURCE_PREFERENCE.photon ?? 99);
    expect(SOURCE_PREFERENCE.photon ?? 99).toBeLessThan(SOURCE_PREFERENCE.geoapify ?? 99);
  });

  it("prefers a record with a postcode", () => {
    const withoutZip = document({ address_parts: {} });
    const withZip = document({ address_parts: { zip: "75001" } });
    expect(isPreferred(withoutZip, withZip)).toBe(true);
    expect(isPreferred(withZip, withoutZip)).toBe(false);
  });

  it("prefers country over locality when layers differ", () => {
    const country = document({ layer: "country", name: { default: "France" } });
    const locality = document({ layer: "locality", name: { default: "Paris" } });
    expect(isPreferred(locality, country)).toBe(true);
  });

  it("prefers tencent over photon for the same place", () => {
    const tencent = document({ source: "tencent" });
    const photon = document({ source: "photon" });
    expect(isPreferred(photon, tencent)).toBe(true);
    expect(isPreferred(tencent, photon)).toBe(false);
  });

  it("considers same name + same parents + same layer as the same place", () => {
    const a = document({ source: "tencent" });
    const b = document({ source: "photon" });
    expect(isDifferent(a, b)).toBe(false);
  });

  it("considers differing names different", () => {
    const a = document({ source: "tencent", name: { default: "东京城镇" } });
    const b = document({ source: "photon", name: { default: "東京都" } });
    expect(isDifferent(a, b)).toBe(true);
  });

  it("dedupes a duplicate pair and keeps the preferred record", () => {
    const tencent = document({ source: "tencent", name: { default: "北京市" } });
    const photon = document({ source: "photon", name: { default: "北京市" } });
    const deduped = dedupeDocuments([tencent, photon]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.source).toBe("tencent");
  });
});
