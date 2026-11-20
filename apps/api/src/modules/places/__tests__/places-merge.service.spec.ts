import { describe, expect, it } from "vitest";

import { PlacesMergeService, type ProviderRecall } from "../places-merge.service.js";
import { normalizeGeoapifyPayloadCandidates } from "../geoapify-normalizer.js";
import { normalizePhotonPayloadCandidates } from "../photon-normalizer.js";
import {
  normalizeTencentGeocodeCandidate,
  normalizeTencentSuggestionCandidates,
} from "../tencent-normalizer.js";
import {
  geoapifyFeature,
  geoapifyPayload,
  photonFeature,
  photonPayload,
  tencentGeocodePayload,
  tencentGeocodeResult,
  tencentSuggestItem,
  tencentSuggestionPayload,
} from "./place-fixtures.js";

/**
 * End-to-end merge tests for the five §5.10 acceptance queries.
 *
 * The provider payloads are trimmed copies of live answers captured on
 * 2026-11-20 (see `.audit/places-routing-spec.md` §6.3). Each provider recall
 * goes through the real normalizer → Pelias Document → confidence → sorting
 * pipeline; nothing is mocked inside the merge service.
 */
const mergeService = new PlacesMergeService();

function recall(
  provider: "tencent" | "geoapify" | "photon",
  candidates: ProviderRecall["candidates"],
): ProviderRecall {
  return { provider, candidates, durationMs: 1 };
}

function tencentGeocode(
  overrides: Parameters<typeof tencentGeocodeResult>[0] = {},
): ProviderRecall["candidates"][number] {
  return normalizeTencentGeocodeCandidate(tencentGeocodePayload(tencentGeocodeResult(overrides)));
}

function tencentSuggestions(items: unknown[]): ProviderRecall["candidates"] {
  return normalizeTencentSuggestionCandidates(tencentSuggestionPayload(items));
}

function geoapify(features: unknown[]): ProviderRecall["candidates"] {
  return normalizeGeoapifyPayloadCandidates(geoapifyPayload(features));
}

function photon(features: unknown[]): ProviderRecall["candidates"] {
  return normalizePhotonPayloadCandidates(photonPayload(features));
}

describe("PlacesMergeService — five acceptance queries", () => {
  it("北京: Tencent locality wins the stable tie and the result is Beijing", () => {
    const outcome = mergeService.merge({
      q: "北京",
      limit: 6,
      recalls: [
        recall("tencent", [
          ...tencentSuggestions([
            tencentSuggestItem({
              title: "北京天安门广场",
              address: "北京市东城区东长安街",
              location: { lat: 39.90374, lng: 116.397827 },
              ad_info: { adcode: 110101, province: "北京市", city: "北京市", district: "东城区" },
            }),
          ]),
          tencentGeocode({
            title: "北京市",
            level: 1,
            location: { lat: 39.9042, lng: 116.4074 },
            address_components: {
              province: "北京市",
              city: "北京市",
              district: "",
              street: "",
              street_number: "",
            },
          }),
        ]),
        recall("geoapify", [
          ...geoapify([
            geoapifyFeature({
              name: "北京市",
              country: "中国",
              country_code: "cn",
              result_type: "city",
              city: "北京市",
              state: "北京市",
              coordinates: [116.3912972, 39.9057136],
              formatted: "北京市, 中国",
            }),
          ]),
        ]),
        recall("photon", [
          ...photon([
            photonFeature({
              name: "北京市",
              country: "中国",
              countrycode: "cn",
              type: "city",
              osm_value: "city",
              city: "北京市",
              state: "北京市",
              coordinates: [116.3912972, 39.9057136],
              osm_id: 9_100_001,
            }),
          ]),
        ]),
      ],
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.items[0]?.provider).toBe("tencent");
    expect(outcome.items[0]?.name).toContain("北京");
    expect(outcome.items[0]?.countryCode).toBe("CN");
    expect(outcome.items[0]?.lat).toBeCloseTo(39.9, 0);
    expect(outcome.items[0]?.lng).toBeCloseTo(116.4, 0);
  });

  it("东京: a Japanese locality outranks the Chinese 东京城镇 venue", () => {
    const outcome = mergeService.merge({
      q: "东京",
      limit: 6,
      recalls: [
        recall("tencent", [
          ...tencentSuggestions([
            tencentSuggestItem({
              title: "东京城镇",
              address: "黑龙江省牡丹江市宁安市东京城镇",
              location: { lat: 44.1134353, lng: 129.2114111 },
              ad_info: { adcode: 231084, province: "黑龙江省", city: "牡丹江市", district: "宁安市" },
            }),
          ]),
        ]),
        recall("geoapify", [
          ...geoapify([
            geoapifyFeature({
              name: "东京都/東京都",
              country: "日本",
              country_code: "jp",
              result_type: "city",
              city: "东京都",
              state: "东京都",
              coordinates: [139.7638947, 35.6768601],
              formatted: "东京都, 日本",
            }),
          ]),
        ]),
        recall("photon", [
          ...photon([
            photonFeature({
              name: "東京",
              country: "日本",
              countrycode: "jp",
              type: "house",
              osm_value: "station",
              street: "9",
              coordinates: [139.766706, 35.6812546],
              osm_id: 9_100_002,
            }),
            photonFeature({
              name: "東京都",
              country: "日本",
              countrycode: "jp",
              type: "city",
              osm_value: "city",
              city: "東京都",
              state: "東京都",
              coordinates: [139.7638947, 35.6768601],
              osm_id: 9_100_003,
            }),
          ]),
        ]),
      ],
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.items[0]?.countryCode).toBe("JP");
    expect(outcome.items[0]?.name).toContain("东京");
    expect(outcome.items[0]?.lat).toBeCloseTo(35.67, 0);
    expect(outcome.items[0]?.lng).toBeCloseTo(139.7, 0);
  });

  it("京都: a Japanese 京都市 locality outranks Chinese venue hits", () => {
    const outcome = mergeService.merge({
      q: "京都",
      limit: 6,
      recalls: [
        recall("tencent", [
          ...tencentSuggestions([
            tencentSuggestItem({
              title: "京都之星购物中心",
              address: "北京市朝阳区",
              location: { lat: 39.92, lng: 116.46 },
              ad_info: { adcode: 110105, province: "北京市", city: "北京市", district: "朝阳区" },
            }),
          ]),
        ]),
        recall("geoapify", [
          ...geoapify([
            geoapifyFeature({
              name: "京都市",
              country: "日本",
              country_code: "jp",
              result_type: "city",
              city: "京都市",
              state: "京都府",
              coordinates: [135.7681441, 35.0115754],
              formatted: "京都市, 京都府, 日本",
            }),
          ]),
        ]),
        recall("photon", [
          ...photon([
            photonFeature({
              name: "京都",
              country: "日本",
              countrycode: "jp",
              type: "house",
              osm_value: "station",
              coordinates: [135.7584303, 34.9846076],
              osm_id: 9_100_004,
            }),
            photonFeature({
              name: "京都市",
              country: "日本",
              countrycode: "jp",
              type: "city",
              osm_value: "city",
              city: "京都市",
              state: "京都府",
              coordinates: [135.7681441, 35.0115754],
              osm_id: 9_100_005,
            }),
          ]),
        ]),
      ],
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.items[0]?.countryCode).toBe("JP");
    expect(outcome.items[0]?.name).toContain("京都");
    expect(outcome.items[0]?.lat).toBeCloseTo(35.0, 0);
    expect(outcome.items[0]?.lng).toBeCloseTo(135.7, 0);
  });

  it("京都: when every global provider is down, a mainland POI is dropped instead of returning a wrong coordinate", () => {
    const outcome = mergeService.merge({
      q: "京都",
      limit: 6,
      recalls: [
        recall("tencent", [
          ...tencentSuggestions([
            tencentSuggestItem({
              title: "京都之星购物中心",
              address: "甘肃省兰州市皋兰县中川镇中川街辅路建投·时光",
              location: { lat: 36.480837, lng: 103.672668 },
              ad_info: { adcode: 620122, province: "甘肃省", city: "兰州市", district: "皋兰县" },
            }),
          ]),
        ]),
        recall("geoapify", []),
        recall("photon", []),
      ],
    });

    expect(outcome.items).toEqual([]);
    expect(outcome.degraded).toBe(true);
  });

  it("建国路87号: Tencent's Beijing SKP POI stays first", () => {
    const outcome = mergeService.merge({
      q: "建国路87号",
      limit: 6,
      recalls: [
        recall("tencent", [
          ...tencentSuggestions([
            tencentSuggestItem({
              title: "北京SKP",
              address: "北京市朝阳区建国路87号",
              location: { lat: 39.910031, lng: 116.47922 },
              ad_info: { adcode: 110105, province: "北京市", city: "北京市", district: "朝阳区" },
            }),
          ]),
        ]),
        recall("geoapify", []),
        recall("photon", [
          ...photon([
            photonFeature({
              name: "建国路75号数字艺术园区",
              country: "中国",
              countrycode: "cn",
              type: "house",
              osm_value: "yes",
              street: "建国路辅路",
              district: "八里庄街道",
              city: "北京市",
              coordinates: [116.4779614, 39.9078618],
              osm_id: 9_100_006,
            }),
          ]),
        ]),
      ],
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.items[0]?.provider).toBe("tencent");
    expect(outcome.items[0]?.name).toBe("北京SKP");
    expect(outcome.items[0]?.type).toBe("poi");
    expect(outcome.items[0]?.countryCode).toBe("CN");
  });

  it("Paris: France ranks before the United States", () => {
    const outcome = mergeService.merge({
      q: "Paris",
      limit: 6,
      recalls: [
        recall("geoapify", [
          ...geoapify([
            geoapifyFeature({
              name: "巴黎",
              country: "法国",
              country_code: "fr",
              result_type: "city",
              city: "巴黎",
              state: "法兰西岛",
              coordinates: [2.3483915, 48.8534951],
              formatted: "巴黎, 法国",
            }),
            geoapifyFeature({
              name: "Paris Township",
              country: "美国",
              country_code: "us",
              result_type: "city",
              city: "Paris Township",
              state: "密歇根州",
              coordinates: [-82.8193312, 43.7277497],
              formatted: "Paris Township, MI, USA",
            }),
          ]),
        ]),
        recall("photon", [
          ...photon([
            photonFeature({
              name: "Paris",
              country: "France",
              countrycode: "fr",
              type: "city",
              osm_value: "city",
              city: "Paris",
              state: "Île-de-France",
              coordinates: [2.3483915, 48.8534951],
              osm_id: 9_100_007,
            }),
            photonFeature({
              name: "Paris",
              country: "United States",
              countrycode: "us",
              type: "city",
              osm_value: "town",
              city: "Paris",
              state: "Texas",
              coordinates: [-95.555513, 33.6617962],
              osm_id: 9_100_008,
            }),
          ]),
        ]),
      ],
    });

    expect(outcome.degraded).toBe(false);
    expect(outcome.items[0]?.countryCode).toBe("FR");
    expect(outcome.items[0]?.name).toContain("巴黎");
    expect(outcome.items[0]?.lat).toBeCloseTo(48.85, 0);
    expect(outcome.items[0]?.lng).toBeCloseTo(2.35, 0);
  });
});
