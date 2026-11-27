import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MapPoint } from "./map-types";
import MapCanvas from "./map-canvas";

vi.mock("maplibre-gl", () => ({ getVersion: () => "test", setWorkerUrl: vi.fn() }));

vi.mock("react-map-gl/maplibre", () => {
  function MockMap({ children }: { children?: ReactNode }) {
    return <div data-testid="mock-map">{children}</div>;
  }
  function MockMarker({ children }: { children?: ReactNode }) {
    return <div>{children}</div>;
  }
  function MockSource({ children }: { children?: ReactNode }) {
    return <div>{children}</div>;
  }
  return {
    default: MockMap,
    Map: MockMap,
    Marker: MockMarker,
    Source: MockSource,
    Layer: () => null,
    NavigationControl: () => null,
  };
});

const POINTS: MapPoint[] = [{ id: "stop-kyoto", label: "京都", lat: 35.0116, lng: 135.7681 }];

describe("MapCanvas attribution", () => {
  it("always credits OSM tiles and names the tile provider", () => {
    render(<MapCanvas points={POINTS} />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "unknown");
    expect(within(credit).getByRole("link", { name: /OpenStreetMap contributors/ })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
    expect(screen.getByText("· OpenFreeMap")).toBeInTheDocument();
  });

  it("adds Powered by Geoapify when the page's search uses Geoapify", () => {
    render(<MapCanvas points={POINTS} placesProvider="geoapify" />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "geoapify");
    expect(credit).toHaveTextContent("Powered by Geoapify");
    expect(credit).toHaveTextContent("© OpenStreetMap contributors");
    expect(within(credit).getByRole("link")).toHaveAttribute(
      "href",
      "https://www.geoapify.com/",
    );
    expect(credit).not.toHaveTextContent(/Photon/);
  });
});
