import { afterEach, describe, expect, it, vi } from "vitest";

import { GeoapifyClient } from "../geoapify.client.js";
import {
  abortAwareFetch,
  firstFetchCall,
  geoapifyPayload,
  jsonResponse,
  testSettings,
} from "./place-fixtures.js";

function createClient(overrides: Parameters<typeof testSettings>[0] = {}) {
  return new GeoapifyClient(
    testSettings({
      provider: "geoapify",
      geoapifyBaseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
      geoapifyApiKey: "fake-key",
      ...overrides,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeoapifyClient", () => {
  it("forwards only text, lang, limit, bias and the server-side key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geoapifyPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().search({
      q: "京都",
      limit: 3,
      lang: "zh",
      bias: "proximity:135.7681,35.0116",
    });

    expect(outcome).toMatchObject({ ok: true, items: [{ name: "京都市" }] });
    const { url, init } = firstFetchCall(fetchMock);
    expect(url.origin).toBe("https://geoapify.example.test");
    expect(url.pathname).toBe("/v1/geocode/autocomplete");
    expect(url.searchParams.get("text")).toBe("京都");
    expect(url.searchParams.get("lang")).toBe("zh");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.searchParams.get("bias")).toBe("proximity:135.7681,35.0116");
    expect(url.searchParams.get("apiKey")).toBe("fake-key");
    expect(url.searchParams.get("format")).toBeNull();
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "follow",
      headers: { accept: "application/json" },
    });
    expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization|user-agent/i);
  });

  it("omits lang and bias when they are not requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geoapifyPayload()));
    vi.stubGlobal("fetch", fetchMock);

    await createClient().search({ q: "Kyoto", limit: 6 });

    const { url } = firstFetchCall(fetchMock);
    expect(url.searchParams.get("lang")).toBeNull();
    expect(url.searchParams.get("bias")).toBeNull();
    expect(url.searchParams.get("text")).toBe("Kyoto");
  });

  it("degrades with a timeout error when the upstream is slower than 1.2 s", async () => {
    vi.stubGlobal("fetch", abortAwareFetch());

    const outcome = await createClient({ geoapifyTimeoutMs: 20 }).search({
      q: "京都",
      limit: 3,
    });

    expect(outcome).toMatchObject({ ok: false, reason: "timeout" });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies a 429 quota response as http_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ statusCode: 429, message: "quota" }, 429)),
    );

    await expect(createClient().search({ q: "京都", limit: 3 })).resolves.toMatchObject({
      ok: false,
      reason: "http_error",
      httpStatus: 429,
    });
  });

  it("classifies a 500 response as http_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500)),
    );

    await expect(createClient().search({ q: "京都", limit: 3 })).resolves.toMatchObject({
      ok: false,
      reason: "http_error",
      httpStatus: 500,
    });
  });

  it("returns normalized places for a valid FeatureCollection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(geoapifyPayload())));

    const outcome = await createClient().search({ q: "京都", limit: 3 });

    expect(outcome.ok && outcome.items).toEqual([
      expect.objectContaining({
        provider: "geoapify",
        name: "京都市",
        timeZone: "Asia/Tokyo",
        bbox: [135.6081441, 34.8515754, 135.9281441, 35.1715754],
      }),
    ]);
  });

  it("degrades on malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(createClient().search({ q: "京都", limit: 3 })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_payload",
    });
  });

  it("degrades when the payload is not a FeatureCollection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ statusCode: 400, message: "bad request" })),
    );

    await expect(createClient().search({ q: "京都", limit: 3 })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_payload",
    });
  });

  it("never calls the network without an API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient({ geoapifyApiKey: null }).search({ q: "京都", limit: 3 }),
    ).resolves.toMatchObject({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid endpoint URL instead of throwing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient({ geoapifyBaseUrl: "not a url" }).search({ q: "京都", limit: 3 }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades on network errors without leaking the failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(createClient().search({ q: "京都", limit: 3 })).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
    });
  });
});