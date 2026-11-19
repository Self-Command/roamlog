import { PlaceSchema } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import {
  GeoapifyPayloadError,
  normalizeGeoapifyFeature,
  normalizeGeoapifyPayload,
} from "../geoapify-normalizer.js";
import { geoapifyFeature, geoapifyPayload } from "./place-fixtures.js";

describe("normalizeGeoapifyFeature", () => {
  it("maps the full Geoapify field set onto the strict Place contract", () => {
    const place = normalizeGeoapifyFeature(geoapifyFeature());

    expect(place).toEqual({
      provider: "geoapify",
      providerPlaceId:
        "51e1bdfea47461405994da8b683bb64140f00103f901d146c57b01000000c00201920309e6b885e6b0b4e5afba",
      name: "京都市",
      address: "京都市, 京都府, 日本",
      country: "日本",
      countryCode: "JP",
      lat: 35.0115754,
      lng: 135.7681441,
      timeZone: "Asia/Tokyo",
      bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
      importance: 0.18666666666666665,
      type: "city",
    });
    expect(PlaceSchema.safeParse(place).success).toBe(true);
  });

  it("drops a feature without a place_id instead of inventing one", () => {
    expect(normalizeGeoapifyFeature(geoapifyFeature({ place_id: undefined }))).toBeNull();
    expect(normalizeGeoapifyFeature(geoapifyFeature({ place_id: "" }))).toBeNull();
  });

  it("drops a feature without coordinates", () => {
    const feature = geoapifyFeature({ coordinates: undefined, lon: undefined, lat: undefined });

    expect(normalizeGeoapifyFeature(feature)).toBeNull();
  });

  it("falls back to properties lon/lat when the geometry is absent", () => {
    const place = normalizeGeoapifyFeature(geoapifyFeature({ coordinates: undefined }));

    expect(place).toMatchObject({ lng: 135.7681441, lat: 35.0115754 });
  });

  it("keeps Geoapify's [west, south, east, north] bbox order", () => {
    const place = normalizeGeoapifyFeature(geoapifyFeature({ bbox: [11, 22, 33, 44] }));

    expect(place?.bbox).toEqual([11, 22, 33, 44]);
  });

  it("reads the property bbox object when the feature bbox is absent", () => {
    const place = normalizeGeoapifyFeature(
      geoapifyFeature({
        bbox: undefined,
        propertyBbox: { lon1: 11, lat1: 22, lon2: 33, lat2: 44 },
      }),
    );

    expect(place?.bbox).toEqual([11, 22, 33, 44]);
  });

  it("drops an inverted bbox instead of leaking an invalid tuple", () => {
    const place = normalizeGeoapifyFeature(geoapifyFeature({ bbox: [33, 22, 11, 44] }));

    expect(place?.bbox).toBeNull();
  });

  it.each([
    ["city", "city"],
    ["suburb", "city"],
    ["district", "city"],
    ["state", "region"],
    ["county", "region"],
    ["country", "country"],
    ["amenity", "poi"],
    ["shop", "poi"],
    ["tourism", "poi"],
    ["building", "poi"],
    ["street", "poi"],
    ["postcode", "other"],
    ["unknown-result", "other"],
  ])("maps result_type %s to %s", (resultType, expected) => {
    expect(normalizeGeoapifyFeature(geoapifyFeature({ result_type: resultType }))?.type).toBe(
      expected,
    );
  });

  it("treats an absent result_type as other", () => {
    expect(normalizeGeoapifyFeature(geoapifyFeature({ result_type: undefined }))?.type).toBe(
      "other",
    );
  });

  it("keeps importance null when rank.importance is absent", () => {
    expect(normalizeGeoapifyFeature(geoapifyFeature({ rank: { confidence: 1 } }))?.importance).toBe(
      null,
    );
  });

  it("rejects an importance outside the contract range", () => {
    expect(
      normalizeGeoapifyFeature(geoapifyFeature({ rank: { importance: 1.4 } }))?.importance,
    ).toBeNull();
  });

  it("keeps timeZone null when the upstream zone is not a valid IANA name", () => {
    const place = normalizeGeoapifyFeature(
      geoapifyFeature({ timezone: { name: "Bad Time/Zone!" } }),
    );

    expect(place?.timeZone).toBeNull();
  });

  it("falls back to address_line1/address_line2 when formatted is absent", () => {
    const place = normalizeGeoapifyFeature(
      geoapifyFeature({ formatted: undefined, address_line1: "清水寺", address_line2: "横滨市, 日本" }),
    );

    expect(place?.address).toBe("清水寺, 横滨市, 日本");
  });

  it("keeps address null when no address component exists", () => {
    const place = normalizeGeoapifyFeature(
      geoapifyFeature({ formatted: undefined, address_line1: undefined, address_line2: undefined }),
    );

    expect(place?.address).toBeNull();
  });

  it.each([
    ["missing name", { name: "" }],
    ["missing country", { country: undefined }],
    ["missing country code", { country_code: undefined }],
    ["invalid country code", { country_code: "JPN" }],
  ])("drops an entry with %s", (_label, overrides) => {
    expect(normalizeGeoapifyFeature(geoapifyFeature(overrides))).toBeNull();
  });
});

describe("normalizeGeoapifyPayload", () => {
  it("keeps valid features and drops invalid ones", () => {
    const places = normalizeGeoapifyPayload(
      geoapifyPayload([
        geoapifyFeature(),
        geoapifyFeature({ place_id: undefined }),
        "not-a-feature",
        geoapifyFeature({ name: "清水寺", result_type: "amenity" }),
      ]),
    );

    expect(places.map((place) => place.name)).toEqual(["京都市", "清水寺"]);
    expect(places.every((place) => place.provider === "geoapify")).toBe(true);
  });

  it("returns an empty list for an empty FeatureCollection", () => {
    expect(normalizeGeoapifyPayload(geoapifyPayload([]))).toEqual([]);
  });

  it("throws a typed error when the payload is not a FeatureCollection", () => {
    expect(() => normalizeGeoapifyPayload({ error: "boom" })).toThrow(GeoapifyPayloadError);
    expect(() => normalizeGeoapifyPayload(null)).toThrow(GeoapifyPayloadError);
    expect(() => normalizeGeoapifyPayload({ features: "nope" })).toThrow(GeoapifyPayloadError);
  });
});