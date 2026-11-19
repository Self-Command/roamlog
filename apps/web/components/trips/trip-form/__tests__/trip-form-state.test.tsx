import { describe, expect, it } from "vitest";

import type { Place } from "@roamlog/contracts";

import { makeTrip } from "@/test/fake-data";

import {
  DEFAULT_TRIP_NIGHTS,
  applyTripDateChange,
  buildCreateTripRequest,
  buildUpdateTripRequest,
  emptyTripFormValues,
  mapServerFieldErrors,
  originFromPlace,
  parseBudgetAmount,
  validateTripForm,
  valuesFromTrip,
  type TripFormValues,
} from "../trip-form-state";
import { addDays, inclusiveDurationDays, todayDateOnly } from "../date-utils";

function makeValues(overrides: Partial<TripFormValues> = {}): TripFormValues {
  return {
    ...emptyTripFormValues(),
    title: "京都七日",
    startDate: "2026-11-01",
    endDate: "2026-11-07",
    ...overrides,
  };
}

describe("default trip dates", () => {
  it("starts with a one-week window so future departure dates are selectable", () => {
    const values = emptyTripFormValues();

    expect(values.startDate).toBe(todayDateOnly());
    expect(values.endDate).toBe(addDays(values.startDate, DEFAULT_TRIP_NIGHTS));
    expect(inclusiveDurationDays(values.startDate, values.endDate)).toBe(7);
    expect(validateTripForm(values).endDate).toBeUndefined();
  });
});

describe("applyTripDateChange", () => {
  it("pushes the end date to the new start when the start moves past the end", () => {
    const change = applyTripDateChange(makeValues(), "startDate", "2026-11-10");

    expect(change.values.startDate).toBe("2026-11-10");
    expect(change.values.endDate).toBe("2026-11-10");
    expect(change.adjusted).toBe("endDate");
    expect(validateTripForm(change.values)).toEqual({});
  });

  it("pulls the start date back when the end moves before the start", () => {
    const change = applyTripDateChange(makeValues(), "endDate", "2026-10-20");

    expect(change.values.startDate).toBe("2026-10-20");
    expect(change.values.endDate).toBe("2026-10-20");
    expect(change.adjusted).toBe("startDate");
    expect(change.values.startDate <= change.values.endDate).toBe(true);
  });

  it("leaves an in-range pick untouched", () => {
    const start = applyTripDateChange(makeValues(), "startDate", "2026-11-03");
    expect(start.adjusted).toBeNull();
    expect(start.values.endDate).toBe("2026-11-07");

    const end = applyTripDateChange(makeValues(), "endDate", "2026-11-09");
    expect(end.adjusted).toBeNull();
    expect(end.values.startDate).toBe("2026-11-01");
  });
});

/** A trip created by this form: countryCodes includes the origin country. */
function makeRoundTrip(overrides: Parameters<typeof makeTrip>[0] = {}) {
  return makeTrip({ countryCodes: ["CN", "JP"], ...overrides });
}

describe("validateTripForm", () => {
  it("requires a title and enforces the 160-character contract limit", () => {
    expect(validateTripForm(makeValues({ title: "   " })).title).toBe("请填写旅行标题");

    const tooLong = validateTripForm(makeValues({ title: "旅".repeat(161) })).title;
    expect(tooLong).toContain("标题最多 160 个字符");
    expect(tooLong).toContain("161");

    expect(validateTripForm(makeValues())).toEqual({});
  });

  it("rejects an end date earlier than the start date", () => {
    const errors = validateTripForm(
      makeValues({ startDate: "2026-11-07", endDate: "2026-11-01" }),
    );

    expect(errors.endDate).toContain("返回日期不能早于出发日期");
    expect(errors.endDate).toContain("2026年11月7日");
    expect(errors.startDate).toBeUndefined();
  });

  it("requires the budget amount and currency to be provided together", () => {
    expect(validateTripForm(makeValues({ budgetAmount: "1200" })).budgetCurrency).toBe(
      "填写金额后需要选择币种",
    );
    expect(validateTripForm(makeValues({ budgetCurrency: "CNY" })).budgetAmount).toBe(
      "选择币种后需要填写金额",
    );
    expect(validateTripForm(makeValues({ budgetAmount: "12.345" })).budgetAmount).toContain(
      "最多两位小数",
    );
    expect(
      validateTripForm(makeValues({ budgetAmount: "1200", budgetCurrency: "cny" })),
    ).toEqual({});
  });

  it("rejects duplicate tags case-insensitively and enforces their limits", () => {
    expect(validateTripForm(makeValues({ tags: ["京都", "京都"] })).tags).toBe("标签不能重复");
    expect(validateTripForm(makeValues({ tags: ["Kyoto", "kyoto"] })).tags).toBe("标签不能重复");
    expect(validateTripForm(makeValues({ tags: [" 京都 "] })).tags).toBeUndefined();
    expect(validateTripForm(makeValues({ tags: Array(21).fill("x").map((_, i) => `t${i}`) })).tags).toBe(
      "最多添加 20 个标签",
    );
  });

  it("rejects more than 30 destinations", () => {
    const destinations = Array.from({ length: 31 }, (_, index) => `目的地 ${index}`);
    expect(validateTripForm(makeValues({ destinations })).destinations).toBe(
      "最多添加 30 个目的地",
    );
    expect(
      validateTripForm(makeValues({ destinations: destinations.slice(0, 30) })).destinations,
    ).toBeUndefined();
  });
});

describe("buildCreateTripRequest", () => {
  it("emits the exact CREATE payload: origin geodata, destinations, budget, tags and guests", () => {
    const payload = buildCreateTripRequest(
      makeValues({
        title: "  京都七日  ",
        summary: "  ",
        origin: {
          name: "上海",
          provider: "photon",
          lat: 31.2304,
          lng: 121.4737,
          countryCode: "CN",
          timeZone: "Asia/Shanghai",
          address: "上海市, 中国",
          bbox: [121.3, 31.1, 121.6, 31.4],
        },
        originQuery: "上海",
        destinations: [" 京都 ", "大阪"],
        destinationCountryCodes: { 京都: "JP", 大阪: "JP" },
        budgetAmount: "12000.50",
        budgetCurrency: "cny",
        tags: [" 寺庙 ", "咖啡"],
        guestNames: [" 小林 "],
      }),
    );

    expect(payload).toEqual({
      title: "京都七日",
      status: "planning",
      visibility: "workspace",
      startDate: "2026-11-01",
      endDate: "2026-11-07",
      origin: "上海",
      originLat: 31.2304,
      originLng: 121.4737,
      originCountryCode: "CN",
      originAddress: "上海市, 中国",
      originBbox: [121.3, 31.1, 121.6, 31.4],
      timeZone: "Asia/Shanghai",
      destinations: ["京都", "大阪"],
      countryCodes: ["CN", "JP"],
      tags: ["寺庙", "咖啡"],
      guestNames: ["小林"],
      budgetAmountMinor: 1200050,
      budgetCurrency: "CNY",
    });
    // A blank summary must be omitted, not sent as an empty string.
    expect(payload).not.toHaveProperty("summary");
  });

  it("keeps a manual origin without inventing coordinates", () => {
    const payload = buildCreateTripRequest(
      makeValues({
        origin: {
          name: "家门口",
          provider: "local",
          lat: null,
          lng: null,
          countryCode: null,
          timeZone: null,
          address: null,
          bbox: null,
        },
        originQuery: "家门口",
      }),
    );

    expect(payload).toMatchObject({
      origin: "家门口",
      originLat: null,
      originLng: null,
      originCountryCode: null,
      timeZone: null,
    });
    expect(payload).not.toHaveProperty("destinations");
    expect(payload).not.toHaveProperty("budgetAmountMinor");
    expect(payload).not.toHaveProperty("tags");
  });
});

describe("originFromPlace", () => {
  const geoapifyPlace: Place = {
    provider: "geoapify",
    providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
    name: "京都市",
    address: "京都市, 京都府, 日本",
    country: "日本",
    countryCode: "JP",
    lat: 35.0115754,
    lng: 135.7681441,
    timeZone: "Asia/Tokyo",
    bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
    importance: 0.18,
    type: "city",
  };

  it("takes the provider and geodata from the place the user picked", () => {
    // Not a literal: a Geoapify pick must stay `geoapify` in the form.
    expect(originFromPlace(geoapifyPlace)).toEqual({
      name: "京都市",
      provider: "geoapify",
      lat: 35.0115754,
      lng: 135.7681441,
      countryCode: "JP",
      timeZone: "Asia/Tokyo",
      address: "京都市, 京都府, 日本",
      bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
    });
  });

  it("submits the picked origin without a provider field", () => {
    const payload = buildCreateTripRequest(
      makeValues({
        origin: originFromPlace(geoapifyPlace),
        originQuery: geoapifyPlace.name,
      }),
    );

    expect(payload).toMatchObject({
      origin: "京都市",
      originLat: 35.0115754,
      originLng: 135.7681441,
      originCountryCode: "JP",
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
      timeZone: "Asia/Tokyo",
    });
    // `Trip` has no origin-provider column and destinations are plain names, so
    // neither `provider` nor `originProvider` may leak into the request.
    expect(payload).not.toHaveProperty("provider");
    expect(payload).not.toHaveProperty("originProvider");
  });
});

describe("buildUpdateTripRequest", () => {
  it("returns null when nothing changed", () => {
    const trip = makeRoundTrip({ version: 3 });
    expect(buildUpdateTripRequest(valuesFromTrip(trip), trip)).toBeNull();
  });

  it("sends only the changed title plus the required version", () => {
    const trip = makeRoundTrip({ id: "0198f000-0000-7000-8000-0000000000aa", version: 4 });
    const patch = buildUpdateTripRequest({ ...valuesFromTrip(trip), title: "冬季京都" }, trip);

    expect(patch).toEqual({ version: 4, title: "冬季京都" });
    expect(patch).not.toHaveProperty("destinations");
    expect(patch).not.toHaveProperty("originLat");
    expect(patch).not.toHaveProperty("tags");
    expect(patch).not.toHaveProperty("budgetAmountMinor");
  });

  it("pairs budget fields and sends them only when the amount changed", () => {
    const trip = makeRoundTrip({ budgetAmountMinor: 1200050, budgetCurrency: "CNY" });
    const values = valuesFromTrip(trip);

    expect(buildUpdateTripRequest(values, trip)).toBeNull();
    expect(
      buildUpdateTripRequest({ ...values, budgetAmount: "900", budgetCurrency: "CNY" }, trip),
    ).toEqual({ version: trip.version, budgetAmountMinor: 90000, budgetCurrency: "CNY" });
    expect(
      buildUpdateTripRequest({ ...values, budgetAmount: "", budgetCurrency: "" }, trip),
    ).toEqual({ version: trip.version, budgetAmountMinor: null, budgetCurrency: null });
  });

  it("clears the origin with the contract sentinel and null geodata", () => {
    const trip = makeRoundTrip({
      origin: "上海",
      originLat: 31.2304,
      originLng: 121.4737,
      originCountryCode: "CN",
      timeZone: "Asia/Shanghai",
    });
    const patch = buildUpdateTripRequest(
      { ...valuesFromTrip(trip), origin: null, originQuery: "" },
      trip,
    );

    expect(patch).toEqual({
      version: trip.version,
      origin: "未填写",
      originLat: null,
      originLng: null,
      originCountryCode: null,
      originAddress: null,
      originBbox: null,
      timeZone: null,
      countryCodes: ["JP"],
    });
  });

  it("echoes the persisted origin address and bbox back into the form", () => {
    const trip = makeRoundTrip({
      origin: "京都",
      originLat: 35.0116,
      originLng: 135.7681,
      originCountryCode: "JP",
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.55, 34.87, 135.87, 35.32],
      timeZone: "Asia/Tokyo",
    });

    const values = valuesFromTrip(trip);
    // The edit form must show what was saved, otherwise the address looks lost.
    expect(values.origin?.address).toBe("京都市, 京都府, 日本");
    expect(values.origin?.bbox).toEqual([135.55, 34.87, 135.87, 35.32]);
    // And an unchanged trip must not emit a patch that would rewrite them.
    expect(buildUpdateTripRequest(values, trip)).toBeNull();
  });

  it("patch 里带上 originAddress/originBbox，清空时发 null", () => {
    const trip = makeRoundTrip({
      origin: "京都",
      originLat: 35.0116,
      originLng: 135.7681,
      originCountryCode: "JP",
      originAddress: "京都市, 京都府, 日本",
      originBbox: [135.55, 34.87, 135.87, 35.32],
      timeZone: "Asia/Tokyo",
    });
    const values = valuesFromTrip(trip);
    const picked = {
      ...values,
      origin: {
        name: "大阪",
        provider: "geoapify" as const,
        lat: 34.6937,
        lng: 135.5023,
        countryCode: "JP",
        timeZone: "Asia/Tokyo",
        address: "大阪市, 大阪府, 日本",
        bbox: [135.13, 34.53, 135.68, 34.87] as [number, number, number, number],
      },
    };
    expect(buildUpdateTripRequest(picked, trip)).toMatchObject({
      version: trip.version,
      origin: "大阪",
      originAddress: "大阪市, 大阪府, 日本",
      originBbox: [135.13, 34.53, 135.68, 34.87],
    });

    const cleared = buildUpdateTripRequest(
      {
        ...values,
        origin: { ...values.origin!, address: null, bbox: null },
      },
      trip,
    );
    expect(cleared).toMatchObject({ version: trip.version, originAddress: null, originBbox: null });
  });

  it("sends destinations and learned country codes when the route changes", () => {
    const trip = makeRoundTrip();
    const patch = buildUpdateTripRequest(
      {
        ...valuesFromTrip(trip),
        destinations: ["京都", "金泽"],
        destinationCountryCodes: { 金泽: "JP" },
      },
      trip,
    );

    expect(patch?.destinations).toEqual(["京都", "金泽"]);
    expect(patch).not.toHaveProperty("countryCodes");
  });
});

describe("parseBudgetAmount", () => {
  it("converts decimal input into minor units without floating point drift", () => {
    expect(parseBudgetAmount("12000.50")).toEqual({ ok: true, amountMinor: 1200050 });
    expect(parseBudgetAmount("0.01")).toEqual({ ok: true, amountMinor: 1 });
    expect(parseBudgetAmount("")).toEqual({ ok: true, amountMinor: null });
    expect(parseBudgetAmount("-1")).toEqual({ ok: false, message: "金额不能为负数" });
  });
});

describe("mapServerFieldErrors", () => {
  it("maps 422 problem paths onto form fields and keeps unmapped issues on the form", () => {
    const errors = mapServerFieldErrors([
      { field: "originLat", message: "纬度不合法" },
      { field: "countryCodes.0", message: "国家代码不合法" },
      { field: "budgetAmountMinor", message: "金额必须非负" },
      { field: "workspaceId", message: "工作区不可写" },
    ]);

    expect(errors).toEqual({
      origin: "纬度不合法",
      destinations: "国家代码不合法",
      budgetAmount: "金额必须非负",
      form: "工作区不可写",
    });
  });
});