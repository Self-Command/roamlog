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
  skin: "catppuccin" as const,
  fontPairing: "literary-warm" as const,
  source: "user" as const,
  canOverride: true,
  updatedAt: "2026-11-22T12:00:00.000Z",
  defaults: {
    mode: "system" as const,
    skin: "editorial-noir" as const,
    fontPairing: "editorial-classic" as const,
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
      saveAppearance({ mode: "dark", skin: "catppuccin", fontPairing: "literary-warm" }),
    ).resolves.toEqual(resolved);
    expect(api.updateMyAppearance).toHaveBeenCalledWith({
      mode: "dark",
      skin: "catppuccin",
      fontPairing: "literary-warm",
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
      skin: "editorial-noir",
      fontPairing: "editorial-classic",
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
    expect(document.documentElement.dataset.skin).toBe("everforest");
    expect(document.documentElement.dataset.font).toBe("swiss-modern");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
