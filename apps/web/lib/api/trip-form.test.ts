import { describe, expect, it, vi } from "vitest";

const searchPlacesMock = vi.hoisted(() => vi.fn());

vi.mock("@roamlog/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roamlog/api-client")>()),
  searchPlaces: searchPlacesMock,
}));

import { searchPlacesForTripForm } from "./trip-form";

describe("searchPlacesForTripForm", () => {
  it("keeps the Geoapify address, time zone, bbox and importance on Place", async () => {
    searchPlacesMock.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: {
        items: [
          {
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
            importance: 0.18666666666666665,
            type: "city",
          },
        ],
        provider: "geoapify",
        degraded: false,
        cached: false,
      },
    });

    const result = await searchPlacesForTripForm("京都");

    expect(result.items[0]).toMatchObject({
      provider: "geoapify",
      address: "京都市, 京都府, 日本",
      timeZone: "Asia/Tokyo",
      bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
      importance: 0.18666666666666665,
    });
    expect(result.provider).toBe("geoapify");
    expect(searchPlacesMock).toHaveBeenCalledWith({ q: "京都", limit: 6 }, { signal: undefined });
  });
});