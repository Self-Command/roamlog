import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GLOBE_CLUSTER_SPEC, PHOTO_CLUSTER_SPEC } from "./cluster-points-source";
import { MapFallback } from "./map-fallback";
import type { MapPoint, MapStop } from "./map-types";
import { WorldMap } from "./world-map";

const point: MapPoint = {
  id: "stop-1",
  label: "京都",
  sublabel: "日本",
  lat: 35.0116,
  lng: 135.7681,
};

const secondPoint: MapPoint = {
  id: "stop-2",
  label: "巴黎",
  sublabel: "法国",
  lat: 48.8566,
  lng: 2.3522,
};

const stop: MapStop = {
  id: "stop-1",
  city: "京都",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  startDate: "2026-11-01",
  endDate: "2026-11-03",
};

const secondStop: MapStop = {
  id: "stop-2",
  city: "巴黎",
  country: "法国",
  countryCode: "FR",
  lat: 48.8566,
  lng: 2.3522,
  startDate: "2026-11-04",
  endDate: "2026-11-06",
};

describe("map and chart semantic theme surfaces", () => {
  it("maps cluster colors onto semantic tokens", () => {
    expect(GLOBE_CLUSTER_SPEC.colorToken).toBe("--map-marker");
    expect(PHOTO_CLUSTER_SPEC.colorToken).toBe("--map-route");
    expect(GLOBE_CLUSTER_SPEC).not.toHaveProperty("color");
    expect(PHOTO_CLUSTER_SPEC).not.toHaveProperty("color");
  });

  it("renders the fallback map from theme variables", () => {
    const { container } = render(
      <MapFallback stops={[stop, secondStop]} points={[point, secondPoint]} />,
    );

    expect(container.querySelector("#fallback-ocean stop")?.getAttribute("stop-color")).toBe(
      "var(--surface-deep)",
    );
    expect(container.querySelector("polyline")?.getAttribute("stroke")).toBe("var(--map-route)");
    expect(container.querySelector("circle[r='4']")?.getAttribute("fill")).toBe("var(--ink)");
  });

  it("renders the standalone world map from theme variables", () => {
    const { container } = render(<WorldMap points={[point]} />);

    expect(container.querySelector("#ocean-wash stop")?.getAttribute("stop-color")).toBe(
      "var(--surface-deep)",
    );
    expect(container.querySelector("#marker-glow stop")?.getAttribute("stop-color")).toBe(
      "var(--map-marker)",
    );
    expect(container.querySelector("circle[r='4.5']")?.getAttribute("fill")).toBe("var(--ink)");
  });
});
