import type { PlaceProvider } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import { providerLabel } from "./format";

describe("providerLabel", () => {
  it("labels every known place provider by its source", () => {
    expect(providerLabel("geoapify")).toBe("Geoapify 搜索");
    expect(providerLabel("photon")).toBe("Photon 搜索");
    expect(providerLabel("local")).toBe("本地地点库");
  });

  it("never shows an automated Geoapify result as manual entry", () => {
    expect(providerLabel("geoapify")).not.toBe("手动录入");
  });

  it("keeps a provider-less stop as manual entry", () => {
    expect(providerLabel(null)).toBe("手动录入");
  });

  it("falls back to neutral copy for an unknown provider instead of the raw enum", () => {
    const unknown = providerLabel("mapbox" as PlaceProvider);

    expect(unknown).toBe("未知来源");
    expect(unknown).not.toMatch(/mapbox/i);
  });
});