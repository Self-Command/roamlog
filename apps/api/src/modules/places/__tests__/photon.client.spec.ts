import { afterEach, describe, expect, it, vi } from "vitest";

import { PhotonClient } from "../photon.client.js";
import { staticPlacesSettingsSource } from "../places.settings.js";
import { abortAwareFetch, firstFetchCall, jsonResponse, photonPayload, photonFeature } from "./place-fixtures.js";

function createClient(overrides: { baseUrl?: string; timeoutMs?: number } = {}) {
  return new PhotonClient(staticPlacesSettingsSource({
    provider: "photon",
    baseUrl: "https://photon.example.test/api",
    timeoutMs: 2_500,
    geoapifyBaseUrl: "https://geoapify.example.test/v1/geocode/autocomplete",
    geoapifyApiKey: "test-key",
    geoapifyTimeoutMs: 1_200,
    geoapifyDailyLimit: 3_000,
    fallbackToPhoton: true,
    cacheTtlSeconds: 900,
    emptyCacheTtlSeconds: 30,
    rateLimitMax: 30,
    rateLimitWindowSeconds: 60,
    rateLimitTimeoutMs: 750,
    redisTimeoutMs: 500,
    defaultLimit: 6,
    defaultLang: "zh",
    ...overrides,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PhotonClient", () => {
  it("forwards only q, limit and lang with a bounded budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();

    const outcome = await client.search({ q: "Paris", limit: 6, lang: "en" });

    expect(outcome).toMatchObject({ ok: true, items: [{ name: "Paris" }] });
    const { url, init } = firstFetchCall(fetchMock);
    expect(url.origin).toBe("https://photon.example.test");
    expect(url.pathname).toBe("/api");
    expect(url.searchParams.get("q")).toBe("Paris");
    expect(url.searchParams.get("limit")).toBe("6");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("bbox")).toBeNull();
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "follow",
      headers: { accept: "application/json" },
    });
    expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization/i);
  });

  it("does not forward a language the Photon public instance rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().search({ q: "shanghai", limit: 3, lang: "zh" });

    expect(outcome.ok).toBe(true);
    expect(firstFetchCall(fetchMock).url.searchParams.get("lang")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits lang when it is not requested and supports a bbox window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(photonPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();

    await client.search({ q: "Lyon", limit: 3, bbox: [-1, 43, 8, 51] });

    const { url } = firstFetchCall(fetchMock);
    expect(url.searchParams.get("lang")).toBeNull();
    expect(url.searchParams.get("bbox")).toBe("-1,43,8,51");
  });

  it("degrades on an upstream HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500)),
    );

    await expect(createClient().search({ q: "Paris", limit: 6 })).resolves.toMatchObject({
      ok: false,
      reason: "http_error",
      httpStatus: 500,
    });
  });

  it("degrades when the upstream returns malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    await expect(createClient().search({ q: "Paris", limit: 6 })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_payload",
    });
  });

  it("degrades when the payload is not a FeatureCollection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ type: "FeatureCollection" })));

    await expect(createClient().search({ q: "Paris", limit: 6 })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_payload",
    });
  });

  it("aborts after the configured timeout", async () => {
    vi.stubGlobal("fetch", abortAwareFetch());
    const client = createClient({ timeoutMs: 20 });

    const outcome = await client.search({ q: "Paris", limit: 6 });

    expect(outcome).toMatchObject({ ok: false, reason: "timeout" });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("retries once without lang when the upstream rejects the language", async () => {
    // Snapshot the URL as a string: the client mutates and reuses one URL object.
    const requested: string[] = [];
    const fetchMock = vi.fn(async (url: URL) => {
      requested.push(String(url));
      return requested.length === 1
        ? jsonResponse({ lang: [{ message: "Language is not supported." }] }, 400)
        : jsonResponse(photonPayload());
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await createClient().search({ q: "paris", limit: 2, lang: "en" });

    expect(outcome).toMatchObject({ ok: true, items: [{ name: "Paris" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requested[0]).toContain("lang=en");
    expect(requested[1]).not.toContain("lang=");
  });

  it("degrades when the lang-less retry also fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient().search({ q: "paris", limit: 2, lang: "en" }),
    ).resolves.toMatchObject({ ok: false, reason: "http_error", httpStatus: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400 that did not carry a language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createClient().search({ q: "paris", limit: 2 })).resolves.toMatchObject({
      ok: false,
      reason: "http_error",
      httpStatus: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degrades on network errors without leaking the failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(createClient().search({ q: "Paris", limit: 6 })).resolves.toMatchObject({
      ok: false,
      reason: "network_error",
    });
  });

  it("rejects an invalid upstream URL instead of throwing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createClient({ baseUrl: "not a url" }).search({ q: "Paris", limit: 6 }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes upstream features and caps nothing beyond the requested limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(photonPayload([photonFeature(), photonFeature()]))),
    );

    const outcome = await createClient().search({ q: "Paris", limit: 1 });

    expect(outcome.ok && outcome.items).toHaveLength(2);
  });
});
