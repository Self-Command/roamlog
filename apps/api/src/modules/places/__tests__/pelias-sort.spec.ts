import type { Document } from "pelias-model";
import { describe, expect, it } from "vitest";

import { sortPeliasHits } from "../ranking/pelias-sort.js";

/**
 * `pelias-sorting@2.0.0` fixtures mirror
 * `pelias/sorting@5eab078c6ad19039cc081bc087ac57f75549ff95/test/index.js`.
 * The comparator is the upstream package; these tests assert the wrapper and
 * the documented ordering from spec §5.10.
 */
function hit(document: Record<string, unknown>): { document: Document } {
  return { document: document as unknown as Document };
}

function layersOf(hits: Array<{ document: Document }>): string[] {
  return hits.map((item) => String(item.document.layer));
}

describe("pelias-sort (upstream ordering fixtures)", () => {
  it("orders mega locality → mega localadmin → country → … → venue", () => {
    const ordered = [
      { layer: "locality", population: 4_000_000 },
      { layer: "localadmin", population: 4_000_000 },
      { layer: "country" },
      { layer: "dependency" },
      { layer: "locality", population: 500_000 },
      { layer: "localadmin", population: 500_000 },
      { layer: "macroregion" },
      { layer: "region" },
      { layer: "borough" },
      { layer: "neighbourhood", popularity: 10_000 },
      { layer: "locality", population: 5_000 },
      { layer: "localadmin", population: 5_000 },
      { layer: "macrocounty" },
      { layer: "county" },
      { layer: "macrohood" },
      { layer: "venue", _score: 0.17 },
      { layer: "neighbourhood", popularity: 1_000 },
      { layer: "locality", population: 0 },
      { layer: "localadmin", population: 0 },
      { layer: "neighbourhood", popularity: 0 },
    ].map((item) => hit(item));

    const sorted = sortPeliasHits([...ordered].reverse());
    expect(layersOf(sorted)).toEqual(layersOf(ordered));
  });

  it("small locality outranks small localadmin (东京 vs 东京镇)", () => {
    const locality = hit({ layer: "locality", population: 0, center_point: {} });
    const localadmin = hit({ layer: "localadmin", population: 0, center_point: {} });
    expect(sortPeliasHits([localadmin, locality]).map((item) => item.document.layer)).toEqual([
      "locality",
      "localadmin",
    ]);
  });

  it("Paris, France (large locality) outranks Paris, TX (medium locality)", () => {
    const parisFrance = hit({ layer: "locality", population: 2_148_000, center_point: {} });
    const parisTexas = hit({ layer: "locality", population: 25_000, center_point: {} });
    expect(
      sortPeliasHits([parisTexas, parisFrance]).map((item) => item.document.population),
    ).toEqual([2_148_000, 25_000]);
  });

  it("keeps the incoming provider order when layer and population tie", () => {
    const tencent = hit({ layer: "locality", population: 0, center_point: {} });
    const geoapify = hit({ layer: "locality", population: 0, center_point: {} });
    const photon = hit({ layer: "locality", population: 0, center_point: {} });
    expect(sortPeliasHits([tencent, geoapify, photon])).toEqual([tencent, geoapify, photon]);
  });

  it("sorts venues by _score", () => {
    const high = hit({ layer: "venue", _score: 0.17, center_point: {} });
    const low = hit({ layer: "venue", _score: 0.16, center_point: {} });
    expect(sortPeliasHits([low, high])).toEqual([high, low]);
  });

  it("uses focus.point distance for non-mega localities when supplied", () => {
    const near = hit({ layer: "locality", population: 0, center_point: { lat: 1, lon: 1 } });
    const far = hit({ layer: "locality", population: 1, center_point: { lat: 2, lon: 2 } });
    expect(sortPeliasHits([far, near], { lat: 0, lon: 0 })).toEqual([near, far]);
  });
});
