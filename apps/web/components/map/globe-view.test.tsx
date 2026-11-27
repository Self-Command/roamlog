import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GlobeView, { pointsToGeoJson, type GlobePoint } from "./globe-view";

const { fakeMap, mapProps } = vi.hoisted(() => ({
  fakeMap: {
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    getBearing: vi.fn(() => 0),
    setBearing: vi.fn(),
    getLayer: vi.fn((id: string) => (id === "background" ? {} : undefined)),
    setPaintProperty: vi.fn(),
    getSource: vi.fn(() => null),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getStyle: vi.fn(() => ({
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
        { id: "water", type: "fill", paint: {} },
      ],
    })),
  },
  mapProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("maplibre-gl", () => ({ getVersion: () => "test", setWorkerUrl: vi.fn() }));

vi.mock("react-map-gl/maplibre", async () => {
  const React = await import("react");
  const MockMap = React.forwardRef(function MockMap(
    props: Record<string, unknown>,
    ref: React.ForwardedRef<unknown>,
  ) {
    mapProps.current = props;
    React.useImperativeHandle(ref, () => ({ getMap: () => fakeMap }));
    React.useEffect(() => {
      const onLoad = props.onLoad as ((event: { target: typeof fakeMap }) => void) | undefined;
      onLoad?.({ target: fakeMap });
    }, []);
    return (
      <div data-testid="mock-globe-map" data-projection={String(props.projection)}>
        {props.children as React.ReactNode}
      </div>
    );
  });
  function MockSource({ children }: { children?: React.ReactNode }) {
    return <div data-testid="mock-globe-source">{children}</div>;
  }
  return {
    default: MockMap,
    Map: MockMap,
    Source: MockSource,
    Layer: () => null,
    NavigationControl: () => null,
  };
});

const points: GlobePoint[] = [
  {
    id: "trip-a:stop-1",
    label: "京都",
    sublabel: "京都慢行 · 日本",
    lat: 35.0116,
    lng: 135.7681,
    tripId: "trip-a",
  },
  {
    id: "trip-b:stop-2",
    label: "巴黎",
    sublabel: "巴黎周末 · 法国",
    lat: 48.8566,
    lng: 2.3522,
    tripId: "trip-b",
  },
];

/** jsdom has no real media queries; `useReducedMotion` reads `matchMedia`. */
function stubMatchMedia({
  reduce = false,
  narrow = false,
}: { reduce?: boolean; narrow?: boolean } = {}) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion")
      ? reduce
      : query.includes("max-width: 639px")
        ? narrow
        : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function stubReducedMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe("GlobeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeMap.getBearing.mockReturnValue(0);
    fakeMap.getLayer.mockImplementation((id: string) => (id === "background" ? {} : undefined));
    fakeMap.getSource.mockReturnValue(null);
  });

  it("renders the globe projection over the OpenFreeMap style", () => {
    render(<GlobeView points={points} />);

    expect(screen.getByTestId("mock-globe-map")).toHaveAttribute("data-projection", "globe");
    expect(screen.getByLabelText("3D 地球视图")).toBeInTheDocument();
    expect(screen.getByText("3D 地球视图，显示 2 个地点")).toBeInTheDocument();
    expect(mapProps.current?.mapStyle).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("paints the globe space black instead of the style's light background", () => {
    render(<GlobeView points={points} />);

    expect(fakeMap.setPaintProperty).toHaveBeenCalledWith(
      "background",
      "background-color",
      "rgb(0, 0, 0)",
    );
  });

  it("keeps the style's land base inside the black globe space", () => {
    render(<GlobeView points={points} />);

    expect(fakeMap.addSource).toHaveBeenCalledWith(
      "globe-land-base",
      expect.objectContaining({ type: "geojson" }),
    );
    expect(fakeMap.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "globe-land-base",
        type: "fill",
        source: "globe-land-base",
        paint: { "fill-color": "#f8f4f0" },
      }),
      "water",
    );
  });

  it("enables cooperative gestures on narrow viewports from the first render", () => {
    const restore = stubMatchMedia({ narrow: true });
    try {
      render(<GlobeView points={points} />);
      expect(mapProps.current?.cooperativeGestures).toBe(true);
    } finally {
      restore();
    }
  });

  it("builds clustered GeoJSON from real coordinates only", () => {
    const geojson = pointsToGeoJson(points);

    expect(geojson.features).toHaveLength(2);
    expect(geojson.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [135.7681, 35.0116],
      [2.3522, 48.8566],
    ]);
    expect(geojson.features.map((feature) => feature.properties.id)).toEqual([
      "trip-a:stop-1",
      "trip-b:stop-2",
    ]);
    expect(geojson.features.map((feature) => feature.properties.tripId)).toEqual([
      "trip-a",
      "trip-b",
    ]);
  });

  it("keeps auto-rotation off by default and toggles it by keyboard", async () => {
    const user = userEvent.setup();
    render(<GlobeView points={points} />);

    const toggle = screen.getByRole("button", { name: "自动旋转" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no ambient rotation and no camera flight under reduced motion", async () => {
    const restore = stubReducedMotion(true);
    try {
      const user = userEvent.setup();
      render(<GlobeView points={points} />);

      expect(screen.queryByRole("button", { name: "自动旋转" })).not.toBeInTheDocument();

      await user.click(within(screen.getByRole("list")).getByRole("button", { name: /京都/ }));

      expect(fakeMap.flyTo).not.toHaveBeenCalled();
      expect(fakeMap.jumpTo).toHaveBeenCalledWith({ center: [135.7681, 35.0116], zoom: 11 });
    } finally {
      restore();
    }
  });

  it("offers the same places as a keyboard list and hands selection to the 2D map", async () => {
    const user = userEvent.setup();
    const onEnterMap = vi.fn();
    render(<GlobeView points={points} onEnterMap={onEnterMap} />);

    const list = screen.getByRole("list");
    const kyoto = within(list).getByRole("button", { name: /京都/ });
    await user.click(kyoto);

    expect(kyoto).toHaveAttribute("aria-pressed", "true");
    expect(fakeMap.flyTo).toHaveBeenCalledWith({
      center: [135.7681, 35.0116],
      zoom: 11,
      essential: true,
    });

    await user.click(screen.getByRole("button", { name: "进入地图" }));
    expect(onEnterMap).toHaveBeenCalledWith(points[0]);
  });
});
