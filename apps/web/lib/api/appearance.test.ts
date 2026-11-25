import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getMyAppearance: vi.fn(),
  updateMyAppearance: vi.fn(),
  resetMyAppearance: vi.fn(),
}));

vi.mock("@roamlog/api-client", () => api);

import {
  applyAppearanceToDocument,
  fetchAppearance,
  resetAppearance,
  saveAppearance,
} from "./appearance";

const resolved = {
  mode: "dark" as const,
  skin: "carbon" as const,
  fontPairing: "carbon-plex" as const,
  source: "user" as const,
  canOverride: true,
  updatedAt: "2026-11-22T12:00:00.000Z",
  defaults: {
    mode: "system" as const,
    skin: "primer" as const,
    fontPairing: "primer-system" as const,
  },
};

function response(data: unknown, status = 200) {
  return { data, status, headers: new Headers() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("web appearance client", () => {
  it("parses the resolved appearance response", async () => {
    api.getMyAppearance.mockResolvedValue(response(resolved));

    await expect(fetchAppearance()).resolves.toEqual(resolved);
  });

  it("sends a partial appearance patch and parses the result", async () => {
    api.updateMyAppearance.mockResolvedValue(response(resolved));

    await expect(
      saveAppearance({ mode: "dark", skin: "carbon", fontPairing: "carbon-plex" }),
    ).resolves.toEqual(resolved);
    expect(api.updateMyAppearance).toHaveBeenCalledWith({
      mode: "dark",
      skin: "carbon",
      fontPairing: "carbon-plex",
    });
  });

  it("returns platform defaults after reset", async () => {
    api.resetMyAppearance.mockResolvedValue(
      response({
        ...resolved,
        ...resolved.defaults,
        source: "platform",
        updatedAt: null,
      }),
    );

    await expect(resetAppearance()).resolves.toMatchObject({
      mode: "system",
      skin: "primer",
      fontPairing: "primer-system",
      source: "platform",
    });
  });

  it("applies the draft attributes and color scheme synchronously", () => {
    applyAppearanceToDocument({
      mode: "light",
      skin: "everforest",
      fontPairing: "swiss-modern",
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(document.documentElement.dataset.skin).toBe("carbon-soft");
    expect(document.documentElement.dataset.font).toBe("fluent-native");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
