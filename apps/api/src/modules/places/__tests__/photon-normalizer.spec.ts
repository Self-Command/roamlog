import { PlaceSchema } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import {
  PhotonPayloadError,
  normalizePhotonFeature,
  normalizePhotonPayload,
} from "../photon-normalizer.js";
import { photonFeature, photonPayload } from "./place-fixtures.js";

describe("normalizePhotonFeature", () => {
  it("maps a Photon feature onto the strict Place contract", () => {
    const place = normalizePhotonFeature(photonFeature());

    expect(place).toEqual({
      provider: "photon",
      providerPlaceId: "R:7444",
      name: "Paris",
      country: "France",
      countryCode: "FR",
      lat: 48.8566,
      lng: 2.3522,
      timeZone: null,
      type: "city",
    });
    expect(PlaceSchema.safeParse(place).success).toBe(true);
  });

  it("keeps providerPlaceId null instead of inventing an OSM id", () => {
    const place = normalizePhotonFeature(photonFeature({ osm_id: undefined, osm_type: undefined }));

    expect(place?.providerPlaceId).toBeNull();
    expect(place?.provider).toBe("photon");
  });

  it.each([
    ["missing name", { name: "" }],
    ["missing country", { country: "" }],
    ["missing country code", { countrycode: null }],
    ["invalid country code", { countrycode: "FRA" }],
    ["missing coordinates", { coordinates: [] }],
    ["lat out of range", { coordinates: [2.35, 95] }],
    ["lng out of range", { coordinates: [190, 48.85] }],
    ["non numeric coordinates", { coordinates: ["2.35", "48.85"] }],
  ])("drops an entry with %s", (_label, overrides) => {
    expect(normalizePhotonFeature(photonFeature(overrides))).toBeNull();
  });

  it.each([
    ["state", "state", "region"],
    ["country", "country", "country"],
    ["house", "house", "poi"],
    ["street", "street", "poi"],
    ["unknown", "square", "other"],
  ])("maps upstream type %s to %s", (_label, upstreamType, expected) => {
    expect(normalizePhotonFeature(photonFeature({ type: upstreamType }))?.type).toBe(expected);
  });

  it("classifies a non-place OSM key without a type as a poi", () => {
    const feature = photonFeature({ type: undefined, osm_key: "tourism", osm_value: undefined });

    expect(normalizePhotonFeature(feature)?.type).toBe("poi");
  });

  it("ignores any upstream provider field and never emits a local place", () => {
    const feature = photonFeature();
    const place = normalizePhotonFeature({ ...feature, properties: { ...feature.properties, provider: "local" } });

    expect(place?.provider).toBe("photon");
  });
});

describe("normalizePhotonPayload", () => {
  it("keeps valid features and drops invalid ones", () => {
    const places = normalizePhotonPayload(
      photonPayload([
        photonFeature(),
        photonFeature({ country: "" }),
        "not-a-feature",
        photonFeature({ osm_id: 12, osm_type: "N", name: "Louvre", type: "house" }),
      ]),
    );

    expect(places.map((place) => place.name)).toEqual(["Paris", "Louvre"]);
    expect(places.every((place) => place.provider === "photon")).toBe(true);
  });

  it("returns an empty list for an empty FeatureCollection", () => {
    expect(normalizePhotonPayload(photonPayload([]))).toEqual([]);
  });

  it("throws a typed error when the payload is not a FeatureCollection", () => {
    expect(() => normalizePhotonPayload({ error: "boom" })).toThrow(PhotonPayloadError);
    expect(() => normalizePhotonPayload(null)).toThrow(PhotonPayloadError);
    expect(() => normalizePhotonPayload({ features: "nope" })).toThrow(PhotonPayloadError);
  });
});
