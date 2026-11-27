import { beforeEach, describe, expect, it, vi } from "vitest";

const { setWorkerUrl } = vi.hoisted(() => ({ setWorkerUrl: vi.fn() }));

vi.mock("maplibre-gl", () => ({
  getVersion: () => "6.18.0",
  setWorkerUrl,
}));

describe("installMapLibreWorker", () => {
  beforeEach(() => {
    setWorkerUrl.mockClear();
    vi.resetModules();
  });

  it("uses the versioned same-origin worker asset", async () => {
    const { installMapLibreWorker } = await import("./maplibre-worker");

    installMapLibreWorker();

    expect(setWorkerUrl).toHaveBeenCalledWith(
      new URL("/maplibre-gl-worker.mjs?v=6.18.0", window.location.origin).href,
    );
  });
});
