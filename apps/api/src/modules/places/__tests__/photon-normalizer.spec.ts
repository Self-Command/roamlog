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
      address: "Paris, Île-de-France, France",
      country: "France",
      countryCode: "FR",
      lat: 48.8566,
      lng: 2.3522,
      timeZone: null,
      bbox: null,
      importance: null,
      type: "city",
    });
    expect(PlaceSchema.safeParse(place).success).toBe(true);
  });

  it("composes the street, house number and postcode Photon already returns", () => {
    const place = normalizePhotonFeature(
      photonFeature({
        street: "Rue de Rivoli",
        housenumber: "12",
        postcode: "75001",
        city: "Paris",
      }),
    );

    expect(place?.address).toBe("12 Rue de Rivoli, 75001 Paris, Île-de-France, France");
  });

  it("composes a partial address when only a postcode/city is present", () => {
    const place = normalizePhotonFeature(photonFeature({ postcode: "75001", city: "Paris" }));

    expect(place?.address).toBe("75001 Paris, Île-de-France, France");
  });

  it("keeps address null when only country/state metadata exists", () => {
    const place = normalizePhotonFeature(photonFeature({ city: undefined }));

    expect(place?.address).toBeNull();
  });

  it("re-orders Photon's [west, north, east, south] extent to [west, south, east, north]", () => {
    const place = normalizePhotonFeature(photonFeature({ extent: [2.22, 48.9, 2.47, 48.81] }));

    expect(place?.bbox).toEqual([2.22, 48.81, 2.47, 48.9]);
  });

  it("drops an inconsistent extent instead of emitting an invalid bbox", () => {
    const place = normalizePhotonFeature(photonFeature({ extent: [2.47, 48.9, 2.22, 48.81] }));

    expect(place?.bbox).toBeNull();
  });

  it("maps Photon's importance when it is in range", () => {
    expect(normalizePhotonFeature(photonFeature({ importance: 0.72 }))?.importance).toBe(0.72);
    expect(normalizePhotonFeature(photonFeature({ importance: 1.4 }))?.importance).toBeNull();
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
