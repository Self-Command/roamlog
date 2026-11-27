import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMedia } from "@/test/cover-upload-doubles";

import GlobeView from "./globe-view";
import { PhotoLayerToggle, PhotoLocationsPanel } from "./photo-layer";
import {
  groupPhotos,
  photoBounds,
  photoGroupKey,
  photosFromMedia,
  photosToGeoJson,
} from "./photo-points";

/** The subset of a MapLibre GeoJSON source `expandClusterIfAny` reads. */
type ClusterSourceDouble = { getClusterExpansionZoom: (clusterId: number) => Promise<number> };

const { fakeMap, mapProps } = vi.hoisted(() => ({
  fakeMap: {
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    getBearing: vi.fn(() => 0),
    setBearing: vi.fn(),
    getLayer: vi.fn(() => ({})),
    setPaintProperty: vi.fn(),
    getSource: vi.fn((): ClusterSourceDouble | null => null),
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
    return <div data-testid="mock-globe-map">{props.children as React.ReactNode}</div>;
  });
  function MockSource({ children }: { children?: React.ReactNode }) {
    return <div data-testid="mock-source">{children}</div>;
  }
  return {
    default: MockMap,
    Map: MockMap,
    Source: MockSource,
    Layer: () => null,
    NavigationControl: () => null,
  };
});

const KYOTO = "0198f000-0000-7000-8000-0000000000e1";
const KYOTO_NEAR = "0198f000-0000-7000-8000-0000000000e2";
const PARIS = "0198f000-0000-7000-8000-0000000000e3";

function mediaWithGps(id: string, lat: number, lng: number, thumb?: string) {
  return makeMedia({
    id,
    status: "ready",
    lat,
    lng,
    date: "2026-11-02",
    caption: "京都的清晨",
    variants: thumb ? { thumb: { url: thumb } } : {},
  });
}

const withGps = [
  mediaWithGps(KYOTO, 35.0116, 135.7681, "https://media.example.test/kyoto-thumb.jpg"),
  mediaWithGps(KYOTO_NEAR, 35.01161, 135.76809),
  mediaWithGps(PARIS, 48.8566, 2.3522, "https://media.example.test/paris-thumb.jpg"),
];

const photos = photosFromMedia(withGps);

/** jsdom has no real media queries; `useReducedMotion` reads `matchMedia`. */
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

async function clickFeature(feature: unknown) {
  const onClick = mapProps.current?.onClick as ((event: unknown) => void) | undefined;
  await act(async () => {
    onClick?.({ features: [feature], target: fakeMap });
  });
}

describe("photo locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeMap.getSource.mockReturnValue(null);
  });

  it("keeps only media rows whose lat/lng pair is present", () => {
    const points = photosFromMedia([
      mediaWithGps(KYOTO, 35.0116, 135.7681, "https://media.example.test/kyoto-thumb.jpg"),
      makeMedia({ id: KYOTO_NEAR, status: "ready", lat: null, lng: null }),
      makeMedia({ id: PARIS, status: "ready", lat: 48.8566, lng: null }),
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      id: KYOTO,
      lat: 35.0116,
      lng: 135.7681,
      thumbUrl: "https://media.example.test/kyoto-thumb.jpg",
    });
  });

  it("builds the same GeoJSON shape the footprint layer uses", () => {
    const geojson = photosToGeoJson(photos);

    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toHaveLength(3);
    expect(geojson.features[0]?.geometry.coordinates).toEqual([135.7681, 35.0116]);
    expect(geojson.features[0]?.properties.id).toBe(KYOTO);
  });

  it("groups photos a few metres apart into one place and frames their extent", () => {
    const groups = groupPhotos(photos);
    const kyoto = groups.find((group) => group.key === photoGroupKey({ lat: 35.0116, lng: 135.7681 }));

    expect(groups).toHaveLength(2);
    expect(kyoto?.photos.map((photo) => photo.id).sort()).toEqual([KYOTO, KYOTO_NEAR].sort());
    expect(photoBounds(photos)).toEqual([
      [2.3522, 35.0116],
      [135.7681, 48.8566],
    ]);
    expect(photoBounds([])).toBeNull();
  });

  it("opens the thumbnails of the chosen place and never fakes a missing image", async () => {
    const user = userEvent.setup();
    const onZoomToPhotos = vi.fn();
    const groups = groupPhotos(photos);

    render(
      <PhotoLocationsPanel
        groups={groups}
        photoCount={photos.length}
        activeKey={null}
        onSelect={vi.fn()}
        onZoomToPhotos={onZoomToPhotos}
      />,
    );

    expect(screen.getByText(/PHOTO LOCATIONS \/ 3/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "缩放到照片" }));
    expect(onZoomToPhotos).toHaveBeenCalledTimes(1);
  });

  it("renders one thumbnail per photo of the open place", () => {
    const kyotoKey = photoGroupKey({ lat: 35.0116, lng: 135.7681 });
    const groups = groupPhotos(photos);

    render(
      <PhotoLocationsPanel
        groups={groups}
        photoCount={photos.length}
        activeKey={kyotoKey}
        onSelect={vi.fn()}
        onZoomToPhotos={vi.fn()}
      />,
    );

    const strip = screen.getByRole("list", { name: "该位置的缩略图" });
    // Two photos sit at this place; only the one with a signed thumbnail has an
    // <img>, the other reports its real state instead of a placeholder image.
    expect(within(strip).getByRole("img")).toHaveAttribute(
      "src",
      "https://media.example.test/kyoto-thumb.jpg",
    );
    expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps the layer switch a keyboard-reachable native button", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(<PhotoLayerToggle enabled photoCount={3} onToggle={onToggle} />);

    const toggle = screen.getByRole("button", { name: /照片图层/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("photo layer on the globe", () => {
  const points = [
    { id: "trip-a:stop-1", label: "京都", lat: 35.0116, lng: 135.7681, tripId: "trip-a" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    fakeMap.getSource.mockReturnValue(null);
  });

  it("adds the photo cluster layers to the interactive set only when enabled", () => {
    const { rerender } = render(<GlobeView points={points} photos={photos} showPhotos={false} />);

    expect(mapProps.current?.interactiveLayerIds).toEqual(["globe-clusters", "globe-point"]);

    rerender(<GlobeView points={points} photos={photos} showPhotos />);
    expect(mapProps.current?.interactiveLayerIds).toEqual([
      "globe-clusters",
      "globe-point",
      "photo-clusters",
      "photo-point",
    ]);
  });

  it("zooms into a photo cluster and clears the open place", async () => {
    fakeMap.getSource.mockReturnValue({ getClusterExpansionZoom: vi.fn(async () => 9) });
    const onSelectPhotoGroup = vi.fn();

    render(
      <GlobeView
        points={points}
        photos={photos}
        showPhotos
        onSelectPhotoGroup={onSelectPhotoGroup}
      />,
    );

    await clickFeature({
      layer: { id: "photo-clusters" },
      properties: { cluster_id: 4 },
      geometry: { coordinates: [135.7681, 35.0116] },
    });

    expect(fakeMap.easeTo).toHaveBeenCalledWith({ center: [135.7681, 35.0116], zoom: 9 });
    expect(onSelectPhotoGroup).toHaveBeenCalledWith(null);
  });

  it("opens the place of a single photo marker and flies to it", async () => {
    const onSelectPhotoGroup = vi.fn();

    render(
      <GlobeView
        points={points}
        photos={photos}
        showPhotos
        onSelectPhotoGroup={onSelectPhotoGroup}
      />,
    );

    await clickFeature({
      layer: { id: "photo-point" },
      properties: { id: PARIS },
      geometry: { coordinates: [2.3522, 48.8566] },
    });

    expect(onSelectPhotoGroup).toHaveBeenCalledWith(photoGroupKey({ lat: 48.8566, lng: 2.3522 }));
    expect(fakeMap.flyTo).toHaveBeenCalledWith({
      center: [2.3522, 48.8566],
      zoom: 11,
      essential: true,
    });
  });

  it("still selects a footprint stop when the photo layer is on", async () => {
    const onSelectPhotoGroup = vi.fn();

    render(
      <GlobeView
        points={points}
        photos={photos}
        showPhotos
        onSelectPhotoGroup={onSelectPhotoGroup}
      />,
    );

    await clickFeature({
      layer: { id: "globe-point" },
      properties: { id: "trip-a:stop-1" },
      geometry: { coordinates: [135.7681, 35.0116] },
    });

    expect(onSelectPhotoGroup).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "进入地图" })).toBeInTheDocument();
  });

  it("places the camera on the photo extent, jumping under reduced motion", () => {
    const restore = stubReducedMotion(true);
    try {
      render(<GlobeView points={points} photos={photos} showPhotos focusPhotosToken={1} />);

      // Three photos span 133° of longitude, so the ladder settles on a globe-wide zoom.
      // The hook starts unreduced and syncs on mount, so the placement that matters
      // is the jumpTo one; the transient flyTo is from the first, pre-sync run.
      expect(fakeMap.jumpTo).toHaveBeenCalledWith({
        center: [expect.closeTo(69.06015), expect.closeTo(41.9341)],
        zoom: 1.7,
      });
    } finally {
      restore();
    }
  });

  it("flies to the same framing when motion is allowed", () => {
    render(<GlobeView points={points} photos={photos} showPhotos focusPhotosToken={1} />);

    expect(fakeMap.flyTo).toHaveBeenCalledWith({
      center: [expect.closeTo(69.06015), expect.closeTo(41.9341)],
      zoom: 1.7,
      essential: true,
    });
    expect(fakeMap.jumpTo).not.toHaveBeenCalled();
  });
});
