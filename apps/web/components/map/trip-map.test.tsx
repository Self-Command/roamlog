import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CitySearch } from "./city-search";
import { clearGeocoderCache } from "./geo";
import type { MapStop } from "./map-types";
import { TripMap } from "./trip-map";

const STOPS: MapStop[] = [
  {
    id: "stop-kyoto",
    city: "京都",
    country: "日本",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    startDate: "2026-11-12",
    endDate: "2026-11-18",
    notes: "南禅寺与哲学之道。",
    order: 0,
  },
  {
    id: "stop-nara",
    city: "奈良",
    country: "日本",
    countryCode: "JP",
    lat: 34.6851,
    lng: 135.8048,
    startDate: "2026-11-15",
    endDate: "2026-11-15",
    notes: "一日往返。",
    order: 1,
  },
];

describe("TripMap", () => {
  it("falls back to an accessible stop list and schematic world map", async () => {
    const onSelect = vi.fn();
    render(
      <TripMap stops={STOPS} forceFallback selectedId="stop-kyoto" onSelect={onSelect} />,
    );

    expect(screen.getByTestId("world-map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择停靠点 京都" })).toBeInTheDocument();
    expect(screen.getByText("地图瓦片不可用时，路线、日期和停靠点仍可完整阅读。")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "选择停靠点 奈良" }));
    expect(onSelect).toHaveBeenCalledWith("stop-nara");
  });

  it("switches to the list fallback when the list control is chosen", async () => {
    render(<TripMap stops={STOPS} forceFallback />);
    await userEvent.click(screen.getByRole("button", { name: "列表" }));
    expect(screen.getByText("LIST VIEW / ACCESSIBLE MAP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择停靠点 京都" })).toBeInTheDocument();
  });

  it("credits the map's Photon city search on top of OSM, even in the fallback", () => {
    render(<TripMap stops={STOPS} forceFallback />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "photon");
    expect(credit).toHaveTextContent("Search by Photon");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(credit).not.toHaveTextContent(/Geoapify/);
  });

  it("keeps the conservative OSM credit when no search is shown", () => {
    render(<TripMap stops={STOPS} forceFallback allowSearch={false} />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "unknown");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(credit).not.toHaveTextContent(/Geoapify|Photon/);
  });
});

describe("CitySearch", () => {
  beforeEach(() => {
    clearGeocoderCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces geocoder requests by 300ms and lists city results", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                osm_id: 1,
                name: "京都",
                state: "京都府",
                country: "日本",
                countrycode: "JP",
              },
              geometry: { coordinates: [135.7681, 35.0116] },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    render(<CitySearch onSelect={vi.fn()} fetcher={fetcher} />);
    fireEvent.change(screen.getByRole("combobox", { name: "搜索城市" }), {
      target: { value: "京都" },
    });

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByText("京都")).toBeInTheDocument();
    expect(screen.getByText(/京都府/)).toBeInTheDocument();
  });
});
