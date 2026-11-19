import { describe, expect, it } from "vitest";

import {
  OSM_ATTRIBUTION_HREF,
  OSM_ATTRIBUTION_TEXT,
  placesAttribution,
  type PlacesProvider,
} from "./places-attribution";

describe("placesAttribution", () => {
  it("credits both Geoapify and OpenStreetMap for geoapify results", () => {
    const copy = placesAttribution("geoapify");
    expect(copy.text).toBe(`Powered by Geoapify · ${OSM_ATTRIBUTION_TEXT}`);
    expect(copy.text).toContain("Powered by Geoapify");
    expect(copy.text).toContain(OSM_ATTRIBUTION_TEXT);
    expect(copy.href).toBe("https://www.geoapify.com/");
    expect(copy.short).toBe("Geoapify · © OSM contributors");
  });

  it("credits Photon and OpenStreetMap for photon results", () => {
    const copy = placesAttribution("photon");
    expect(copy.text).toBe(`Search by Photon · ${OSM_ATTRIBUTION_TEXT}`);
    expect(copy.href).toBe("https://photon.komoot.io/");
    expect(copy.short).toBe("Photon · © OSM contributors");
  });

  it("shows manual entry without borrowing any third-party credit", () => {
    const copy = placesAttribution("local");
    expect(copy.text).toBe("手动录入");
    expect(copy.short).toBe("手动录入");
    expect(copy.href).toBeNull();
    expect(copy.text).not.toMatch(/Geoapify|Photon|OpenStreetMap|OSM/);
  });

  it("falls back to the OSM credit when the provider is unknown", () => {
    for (const provider of [null, "unexpected" as PlacesProvider]) {
      const copy = placesAttribution(provider);
      expect(copy.text).toBe(OSM_ATTRIBUTION_TEXT);
      expect(copy.href).toBe(OSM_ATTRIBUTION_HREF);
      expect(copy.short).toBe("© OSM contributors");
      expect(copy.text).not.toMatch(/Geoapify|Photon/);
    }
  });

  it("never lets the three real providers share copy or links", () => {
    const geoapify = placesAttribution("geoapify");
    const photon = placesAttribution("photon");
    const local = placesAttribution("local");

    expect(geoapify.text).not.toContain("Photon");
    expect(photon.text).not.toContain("Geoapify");
    expect(geoapify.text).not.toBe(photon.text);
    expect(new Set([geoapify.text, photon.text, local.text]).size).toBe(3);
    expect(new Set([geoapify.href, photon.href, local.href]).size).toBe(3);
  });

  it("keeps every link on https and gives the map-only copy the OSM link", () => {
    const providers: PlacesProvider[] = ["geoapify", "photon", null, "local"];
    for (const provider of providers) {
      const { href } = placesAttribution(provider);
      if (href !== null) expect(href.startsWith("https://")).toBe(true);
    }
    expect(placesAttribution(null).href).toBe(
      "https://www.openstreetmap.org/copyright",
    );
  });
});