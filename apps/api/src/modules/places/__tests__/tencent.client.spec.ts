import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceSchema } from "@roamlog/contracts";

import { staticPlacesSettingsSource, type PlacesSettings } from "../places.settings.js";
import { TencentClient } from "../tencent.client.js";
import {
  abortAwareFetch,
  firstFetchCall,
  jsonResponse,
  TENCENT_SKP_GCJ02,
  TENCENT_SKP_WGS84,
  tencentErrorPayload,
  tencentGeocodePayload,
  tencentGeocodeResult,
  tencentReverseResult,
  tencentSuggestItem,
  tencentSuggestionPayload,
  testSettings,
} from "./place-fixtures.js";

function createClient(overrides: Partial<PlacesSettings> = {}): TencentClient {
  return new TencentClient(staticPlacesSettingsSource(testSettings(overrides)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TencentClient.suggest", () => {
  it("calls place/v1/suggestion with only keyword, page_size and key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().suggest({ q: "北京市朝阳区建国路87号", limit: 3 });

    expect(outcome.ok).toBe(true);
    const { url, init } = firstFetchCall(fetchMock);
    expect(url.origin).toBe("https://tencent.example.test");
    expect(url.pathname).toBe("/ws/place/v1/suggestion");
    expect(url.searchParams.get("keyword")).toBe("北京市朝阳区建国路87号");
    expect(url.searchParams.get("page_size")).toBe("3");
    expect(url.searchParams.get("key")).toBe("test-key");
    // No user identity, no cookies.
    expect(init.credentials).toBe("omit");
    expect([...url.searchParams.keys()].sort()).toEqual(["key", "keyword", "page_size"]);
  });

  it("normalizes title/address/location and converts GCJ-02 to WGS-84", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentSuggestionPayload())));

    const outcome = await createClient().suggest({ q: "建国路87号", limit: 3 });

    if (!outcome.ok) {
      throw new Error(`expected a suggestion, got ${outcome.code}`);
    }
    expect(outcome.items).toHaveLength(1);
    const place = outcome.items[0];
    expect(place).toMatchObject({
      provider: "tencent",
      providerPlaceId: "10233345183344841920",
      name: "北京SKP",
      address: "北京市朝阳区建国路87号",
      country: "中国",
      countryCode: "CN",
      timeZone: null,
      bbox: null,
      importance: null,
      type: "poi",
    });
    // gcoord GCJ-02 → WGS-84, not the raw upstream point.
    expect(place?.lat).toBeCloseTo(TENCENT_SKP_WGS84.lat, 9);
    expect(place?.lng).toBeCloseTo(TENCENT_SKP_WGS84.lng, 9);
    expect(place?.lat).not.toBe(TENCENT_SKP_GCJ02.lat);
    expect(PlaceSchema.parse(place)).toEqual(place);
  });

  it("keeps the flat adcode/province/city/district shape working too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          tencentSuggestionPayload([
            tencentSuggestItem({
              ad_info: undefined,
              province: "广东省",
              city: "深圳市",
              district: "南山区",
            }),
          ]),
        ),
      ),
    );

    const outcome = await createClient().suggest({ q: "深南大道", limit: 3 });

    if (!outcome.ok) {
      throw new Error(`expected a suggestion, got ${outcome.code}`);
    }
    expect(outcome.items[0]).toMatchObject({
      address: "广东省深圳市南山区建国路87号",
      country: "中国",
      countryCode: "CN",
    });
  });

  it("keeps an already fully formatted upstream address instead of doubling it", async () => {
    // Live `place/v1/suggestion` answers for 深圳深南大道10000号 carry the whole
    // administrative prefix in `address`; prepending it again would produce
    // `广东省深圳市南山区广东省深圳市南山区深南大道10000号`.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          tencentSuggestionPayload([
            tencentSuggestItem({
              title: "腾讯大厦",
              address: "广东省深圳市南山区深南大道10000号",
              ad_info: {
                adcode: 440305,
                province: "广东省",
                city: "深圳市",
                district: "南山区",
              },
            }),
          ]),
        ),
      ),
    );

    const outcome = await createClient().suggest({ q: "深圳深南大道10000号", limit: 3 });

    if (!outcome.ok) {
      throw new Error(`expected a suggestion, got ${outcome.code}`);
    }
    expect(outcome.items[0]?.address).toBe("广东省深圳市南山区深南大道10000号");
  });

  it("maps an administrative division (type 4) to the region place type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(tencentSuggestionPayload([tencentSuggestItem({ type: 4 })])),
      ),
    );

    const outcome = await createClient().suggest({ q: "朝阳区", limit: 3 });

    if (!outcome.ok) {
      throw new Error(`expected a suggestion, got ${outcome.code}`);
    }
    expect(outcome.items[0]?.type).toBe("region");
  });

  it("drops an entry without a usable location instead of inventing one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          tencentSuggestionPayload([
            tencentSuggestItem({ location: undefined }),
            tencentSuggestItem({ id: "second", title: "腾讯大厦" }),
          ]),
        ),
      ),
    );

    const outcome = await createClient().suggest({ q: "建国路", limit: 3 });

    if (!outcome.ok) {
      throw new Error(`expected a suggestion, got ${outcome.code}`);
    }
    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0]?.name).toBe("腾讯大厦");
  });

  it("treats the documented 'no result' statuses as an empty list", async () => {
    for (const status of [347, 387, 393]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentErrorPayload(status))));

      const outcome = await createClient().suggest({ q: "建国路", limit: 3 });

      expect(outcome).toMatchObject({ ok: true, items: [] });
    }
  });
});

describe("TencentClient failure mapping", () => {
  it("reports status 121 as QUOTA_EXCEEDED and never retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(tencentErrorPayload(121, "此key每日调用量已达到上限")));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().suggest({ q: "建国路87号", limit: 3 });

    expect(outcome).toMatchObject({
      ok: false,
      code: "QUOTA_EXCEEDED",
      reason: "quota_exceeded",
      upstreamStatus: 121,
      upstreamMessage: "此key每日调用量已达到上限",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const statusCases: [number, string][] = [
    [120, "RATE_LIMITED"],
    [110, "UNAUTHORIZED"],
    [190, "UNAUTHORIZED"],
    [199, "UNAUTHORIZED"],
    [301, "INVALID_REQUEST"],
    [310, "INVALID_REQUEST"],
    [365, "INVALID_REQUEST"],
    [500, "UPSTREAM_ERROR"],
    [600, "UPSTREAM_ERROR"],
    [2, "UNKNOWN_STATUS"],
  ];

  it.each(statusCases)("maps the documented status %i to %s", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(tencentErrorPayload(status))));

    const outcome = await createClient().suggest({ q: "建国路87号", limit: 3 });

    expect(outcome).toMatchObject({ ok: false, code, upstreamStatus: status });
  });

  it("reports a non-2xx HTTP response with its status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500)));

    const outcome = await createClient().suggest({ q: "建国路87号", limit: 3 });

    expect(outcome).toMatchObject({ ok: false, code: "HTTP_ERROR", httpStatus: 500 });
  });

  it("reports malformed JSON as INVALID_PAYLOAD", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    const outcome = await createClient().suggest({ q: "建国路87号", limit: 3 });

    expect(outcome).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("bounds the request with the 1.5 s budget", async () => {
    vi.stubGlobal("fetch", abortAwareFetch());

    const outcome = await createClient({ tencentTimeoutMs: 20 }).suggest({
      q: "建国路87号",
      limit: 3,
    });

    expect(outcome).toMatchObject({ ok: false, code: "TIMEOUT" });
  });

  it("never calls the network when the key is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const suggest = await createClient({ tencentApiKey: null }).suggest({ q: "建国路", limit: 3 });
    const geocode = await createClient({ tencentApiKey: null }).geocode({ address: "建国路87号" });

    expect(suggest).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(geocode).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unusable base URL instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const outcome = await createClient({ tencentBaseUrl: "not-a-url" }).suggest({
      q: "建国路",
      limit: 3,
    });

    expect(outcome).toMatchObject({ ok: false, code: "INVALID_URL" });
  });
});

describe("TencentClient geocoder", () => {
  it("forward geocodes through geocoder/v1?address=", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(tencentGeocodePayload(tencentGeocodeResult())));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().geocode({ address: "北京市海淀区彩和坊路海淀西大街74号" });

    const { url } = firstFetchCall(fetchMock);
    expect(url.pathname).toBe("/ws/geocoder/v1");
    expect(url.searchParams.get("address")).toBe("北京市海淀区彩和坊路海淀西大街74号");

    if (!outcome.ok) {
      throw new Error(`expected a geocode, got ${outcome.code}`);
    }
    expect(outcome.place).toMatchObject({
      provider: "tencent",
      providerPlaceId: null,
      name: "北京市海淀区彩和坊路海淀西大街74号",
      address: "北京市海淀区彩和坊路海淀西大街74号",
      country: "中国",
      countryCode: "CN",
      // `level: 9` is a door-plate level result in the documented precision table.
      type: "poi",
    });
    expect(outcome.place.lat).toBeCloseTo(39.982888253300985, 9);
    expect(outcome.place.lng).toBeCloseTo(116.30140410185919, 9);
  });

  it("reverse geocodes with the documented lat,lng order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(tencentGeocodePayload(tencentReverseResult())));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().reverse({ lat: 22.539878, lng: 113.934528 });

    const { url } = firstFetchCall(fetchMock);
    expect(url.pathname).toBe("/ws/geocoder/v1");
    expect(url.searchParams.get("location")).toBe("22.539878,113.934528");

    if (!outcome.ok) {
      throw new Error(`expected a reverse geocode, got ${outcome.code}`);
    }
    expect(outcome.place).toMatchObject({
      provider: "tencent",
      name: "腾讯滨海大厦(滨海大道辅路)",
      address: "广东省深圳市南山区深南大道10000号",
      country: "中国",
      countryCode: "CN",
      type: "other",
    });
    expect(outcome.place.lat).toBeCloseTo(22.542914088761222, 9);
    expect(outcome.place.lng).toBeCloseTo(113.9296639637554, 9);
  });

  it("falls back to the requested coordinate when the result omits its own", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(tencentGeocodePayload(tencentReverseResult({ location: undefined }))),
      ),
    );

    const outcome = await createClient().reverse({ lat: 22.539878, lng: 113.934528 });

    if (!outcome.ok) {
      throw new Error(`expected a reverse geocode, got ${outcome.code}`);
    }
    expect(outcome.place.lat).toBe(22.539878);
    expect(outcome.place.lng).toBe(113.934528);
  });

  it("reports a result-less geocoder body as INVALID_PAYLOAD", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 0, message: "ok" })));

    const outcome = await createClient().geocode({ address: "建国路87号" });

    expect(outcome).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });
});
