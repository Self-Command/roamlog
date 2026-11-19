import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlacesAttribution } from "./places-attribution";

describe("PlacesAttribution", () => {
  it("shows the OSM credit with a safe, keyboard-focusable external link", () => {
    render(<PlacesAttribution provider={null} />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit).toHaveAttribute("data-provider", "unknown");
    expect(credit).not.toHaveAttribute("aria-hidden");

    const link = screen.getByRole("link", { name: /OpenStreetMap contributors/ });
    expect(link).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.className).toContain("focus-visible:ring-2");
    expect(link).toHaveTextContent("© OSM contributors");
  });

  it("shows both required credits for Geoapify and never claims Photon", () => {
    render(<PlacesAttribution provider="geoapify" />);

    const link = screen.getByRole("link", { name: /Powered by Geoapify/ });
    expect(link).toHaveAttribute("href", "https://www.geoapify.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Powered by Geoapify");
    expect(link).toHaveTextContent("© OpenStreetMap contributors");
    expect(link).not.toHaveTextContent(/Photon/);
    // The compact 390px variant stays truthful about both sources.
    expect(link).toHaveTextContent("Geoapify · © OSM contributors");
  });

  it("credits Photon for Photon and never claims Geoapify", () => {
    render(<PlacesAttribution provider="photon" />);

    const link = screen.getByRole("link", { name: /Search by Photon/ });
    expect(link).toHaveAttribute("href", "https://photon.komoot.io/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).not.toHaveTextContent(/Geoapify/);
    expect(link).toHaveTextContent("© OpenStreetMap contributors");
  });

  it("shows manual entry without any third-party link or credit", () => {
    render(<PlacesAttribution provider="local" />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit).toHaveTextContent("手动录入");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(credit).not.toHaveTextContent(/Geoapify|Photon|OpenStreetMap|OSM/);
  });

  it("stays readable on the map overlay instead of using the canvas stone tone", () => {
    render(<PlacesAttribution provider="geoapify" tone="overlay" />);

    const credit = screen.getByTestId("places-attribution");
    expect(credit.className).toContain("text-white/70");
    expect(credit.className).not.toContain("text-stone");
    expect(credit.className).toContain("whitespace-nowrap");
  });
});