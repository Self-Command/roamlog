import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ROBOTS,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_TITLE,
  DEFAULT_TITLE_TEMPLATE,
  MEDIA_COMPRESSION_DEFAULTS,
  MEDIA_COMPRESSION_LIMITS,
  PUBLIC_SETTINGS_REVALIDATE_SECONDS,
  PUBLIC_SETTING_KEYS,
  THEME_ACCENT_TOKENS,
  applyTitleTemplate,
  buildSiteMetadata,
  getMediaCompressionPolicy,
  getPublicSettings,
  resolveThemeAccent,
  resolveThemeMode,
  resolveThemePresentation,
  useMediaCompressionPolicy,
  usePublicSettings,
  type MediaCompressionPolicy,
  type PublicSettingsMap,
} from "./settings";

const SETTINGS: PublicSettingsMap = {
  "site.title": "Atlas Journal",
  "site.description": "Field notes for slow travel.",
  "general.defaultLanguage": "en",
  "theme.accent": "blue",
  "theme.defaultMode": "dark",
  "theme.loginTagline": "Pack light, write often.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function publicSettingsBody(settings: PublicSettingsMap) {
  return { settings, generatedAt: "2026-11-19T00:00:00.000Z" };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.restoreAllMocks();
});

describe("getPublicSettings", () => {
  it("reads the public settings from the API with a 30 second revalidation window", async () => {
    const fetcher = vi.fn(async () => jsonResponse(publicSettingsBody(SETTINGS)));

    const settings = await getPublicSettings({
      apiUrl: "http://api.test",
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(settings).toEqual(SETTINGS);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/v1/public/settings",
      expect.objectContaining({
        headers: { accept: "application/json" },
        next: { revalidate: PUBLIC_SETTINGS_REVALIDATE_SECONDS },
      }),
    );
    expect(PUBLIC_SETTINGS_REVALIDATE_SECONDS).toBe(30);
  });

  it("returns the code defaults without throwing when the API answers 500", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ message: "boom" }, 500));

    await expect(
      getPublicSettings({ apiUrl: "http://api.test", fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toEqual({});
    expect(warn.mock.calls[0]?.[0]).toContain("HTTP 500");
  });

  it("returns the code defaults without throwing when the request times out", async () => {
    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const started = Date.now();
    const settings = await getPublicSettings({
      apiUrl: "http://api.test",
      timeoutMs: 10,
      fetcher: hanging as unknown as typeof fetch,
    });

    expect(settings).toEqual({});
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(warn.mock.calls[0]?.[0]).toContain("using code defaults");
  });

  it("returns the code defaults when the payload does not match the contract", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ settings: { "site.title": 7 } }));

    await expect(
      getPublicSettings({ apiUrl: "http://api.test", fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toEqual({});
    expect(warn.mock.calls[0]?.[0]).toContain("did not match the contract");
  });
});

describe("buildSiteMetadata", () => {
  it("uses runtime site and SEO settings when they are present", () => {
    const metadata = buildSiteMetadata({
      ...SETTINGS,
      "seo.titleTemplate": "%s · Atlas",
      "seo.descriptionTemplate": "Plan together, remember together.",
      "seo.ogImageUrl": "https://cdn.example.com/og.png",
      "seo.robots": "noindex,nofollow",
    });

    expect(metadata.title).toEqual({ default: "Atlas Journal", template: "%s · Atlas" });
    expect(metadata.description).toBe("Field notes for slow travel.");
    expect(metadata.openGraph).toMatchObject({
      title: "Atlas Journal · Atlas",
      description: "Plan together, remember together.",
      images: [{ url: "https://cdn.example.com/og.png" }],
    });
    expect(metadata.robots).toBe("noindex,nofollow");
  });

  it("replaces %s in the title template and keeps a placeholder-free template as a complete title", () => {
    expect(applyTitleTemplate("%s | Roamlog", "页面标题")).toBe("页面标题 | Roamlog");
    expect(applyTitleTemplate("页面标题 | Roamlog", "另一个页面")).toBe("页面标题 | Roamlog");

    const withPlaceholder = buildSiteMetadata({
      "site.title": "Roamlog",
      "seo.titleTemplate": "%s | Roamlog",
    });
    expect(withPlaceholder.title).toEqual({ default: "Roamlog", template: "%s | Roamlog" });
    expect(withPlaceholder.openGraph).toMatchObject({ title: "Roamlog | Roamlog" });

    const completeTitle = buildSiteMetadata({
      "site.title": "Roamlog",
      "seo.titleTemplate": "Roamlog",
    });
    expect(completeTitle.title).toEqual({ default: "Roamlog", template: "Roamlog" });
    expect(completeTitle.openGraph).toMatchObject({ title: "Roamlog" });
  });

  it("omits openGraph.images when seo.ogImageUrl is empty", () => {
    for (const settings of [
      { "seo.ogImageUrl": "" },
      { "seo.ogImageUrl": null },
      {},
    ] as PublicSettingsMap[]) {
      const metadata = buildSiteMetadata(settings);
      expect(metadata.openGraph && "images" in metadata.openGraph).toBe(false);
    }
  });

  it("applies the configured robots directive", () => {
    const metadata = buildSiteMetadata({ "seo.robots": "noindex,nofollow" });

    expect(metadata.robots).toBe("noindex,nofollow");
    expect(JSON.stringify(metadata)).not.toMatch(/light/u);
  });

  it("falls back to the built-in defaults when the settings are missing", () => {
    const metadata = buildSiteMetadata({});

    expect(metadata.title).toEqual({
      default: DEFAULT_SITE_TITLE,
      template: DEFAULT_TITLE_TEMPLATE,
    });
    expect(metadata.description).toBe(DEFAULT_SITE_DESCRIPTION);
    expect(metadata.openGraph).toMatchObject({
      title: DEFAULT_SITE_TITLE,
      description: DEFAULT_SITE_DESCRIPTION,
    });
    expect(metadata.openGraph && "images" in metadata.openGraph).toBe(false);
    expect(metadata.robots).toBe(DEFAULT_ROBOTS);

    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toMatch(/error|失败|异常|unavailable/i);
  });

  it("derives the title template from a configured site name", () => {
    const metadata = buildSiteMetadata({ "site.title": "Field Atlas" });

    expect(metadata.title).toEqual({
      default: "Field Atlas",
      template: "%s · Field Atlas",
    });
  });
});

describe("resolveThemePresentation", () => {
  it("maps runtime accent and mode onto server-rendered CSS variables", () => {
    const fallback = resolveThemePresentation({});
    expect(fallback.mode).toBe("system");
    expect(fallback.dataTheme).toBe("system");
    expect(fallback.colorScheme).toBe("light dark");
    expect(fallback.accent).toBe("white");
    expect(fallback.style.colorScheme).toBe("light dark");

    const themed = resolveThemePresentation({
      "theme.accent": "blue",
      "theme.defaultMode": "dark",
    });
    expect(themed.dataTheme).toBe("dark");
    expect(themed.colorScheme).toBe("dark");
    expect(themed.style.colorScheme).toBe("dark");
    expect(themed.style["--accent-primary"]).toBe(THEME_ACCENT_TOKENS.blue.primary);
    expect(themed.style["--accent-primary"]).not.toBe(fallback.style["--accent-primary"]);
    expect(themed.style["--accent-primary-glow"]).toBe(THEME_ACCENT_TOKENS.blue.glow);
  });

  it("normalizes the removed light mode to system instead of rendering it", () => {
    expect(resolveThemeMode("light")).toBe("system");
    expect(resolveThemeMode("dark")).toBe("dark");
    expect(resolveThemeMode("system")).toBe("system");

    const presentation = resolveThemePresentation({ "theme.defaultMode": "light" });
    expect(presentation.mode).toBe("system");
    expect(presentation.dataTheme).toBe("system");
    expect(presentation.colorScheme).toBe("light dark");
    expect(JSON.stringify(presentation)).not.toContain('"light"');
  });

  it("rejects unknown accent and mode values instead of throwing", () => {
    expect(resolveThemeMode("sepia")).toBe("system");
    expect(resolveThemeAccent("chartreuse")).toBe("white");
  });

  it("mirrors every public SEO key in PUBLIC_SETTING_KEYS", () => {
    for (const key of [
      "seo.titleTemplate",
      "seo.descriptionTemplate",
      "seo.ogImageUrl",
      "seo.robots",
    ]) {
      expect(PUBLIC_SETTING_KEYS).toContain(key);
    }
  });
});

describe("usePublicSettings", () => {
  function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };
  }

  it("shares one cache entry between consumers within the 30 second stale window", async () => {
    const fetcher = vi.fn(async () => jsonResponse(publicSettingsBody(SETTINGS)));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const first = renderHook(
      () => usePublicSettings({ fetcher: fetcher as unknown as typeof fetch }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(first.result.current.data).toEqual(SETTINGS));

    const second = renderHook(
      () => usePublicSettings({ fetcher: fetcher as unknown as typeof fetch }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(second.result.current.data).toEqual(SETTINGS));

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("resolves to the code defaults instead of surfacing an error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { result } = renderHook(
      () => usePublicSettings({ fetcher: fetcher as unknown as typeof fetch }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
    expect(warn.mock.calls[0]?.[0]).toContain("using code defaults");
  });
});

describe("getMediaCompressionPolicy", () => {
  it("falls back to the code defaults when the public media keys are missing", () => {
    expect(getMediaCompressionPolicy({})).toEqual({
      maxEdge: 2000,
      quality: 0.82,
      targetBytes: 1_500_000,
      maxUploadBytes: 25_000_000,
    });
    expect(getMediaCompressionPolicy(SETTINGS)).toEqual(MEDIA_COMPRESSION_DEFAULTS);
  });

  it("passes through values inside the safe client band", () => {
    const settings: PublicSettingsMap = {
      "media.maxEdge": 1200,
      "media.quality": 0.9,
      "media.targetBytes": 3_000_000,
      "media.maxUploadBytes": 8 * 1024 * 1024,
    };

    expect(getMediaCompressionPolicy(settings)).toEqual({
      maxEdge: 1200,
      quality: 0.9,
      targetBytes: 3_000_000,
      maxUploadBytes: 8 * 1024 * 1024,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the defaults and warns for out-of-band values", () => {
    const policy = getMediaCompressionPolicy({
      "media.maxEdge": 8000,
      "media.quality": 0.2,
      "media.targetBytes": 20_000_000,
      "media.maxUploadBytes": 100 * 1024 * 1024,
    });

    expect(policy).toEqual(MEDIA_COMPRESSION_DEFAULTS);
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.map(([message]: unknown[]) => String(message))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("media.maxEdge=8000"),
        expect.stringContaining("media.quality=0.2"),
        expect.stringContaining("media.targetBytes=20000000"),
        expect.stringContaining("media.maxUploadBytes=104857600"),
      ]),
    );
  });

  it("treats NaN, negatives and wrong types as invalid without throwing", () => {
    const policy = getMediaCompressionPolicy({
      "media.maxEdge": Number.NaN,
      "media.quality": -0.2,
      "media.targetBytes": "1500000",
      "media.maxUploadBytes": Number.POSITIVE_INFINITY,
    });

    expect(policy).toEqual(MEDIA_COMPRESSION_DEFAULTS);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("documents safe bounds that contain the defaults", () => {
    for (const [key, value] of Object.entries(MEDIA_COMPRESSION_DEFAULTS)) {
      const bounds = MEDIA_COMPRESSION_LIMITS[key as keyof MediaCompressionPolicy];
      expect(value).toBeGreaterThanOrEqual(bounds.min);
      expect(value).toBeLessThanOrEqual(bounds.max);
    }
    expect(MEDIA_COMPRESSION_LIMITS.maxUploadBytes.max).toBe(25_000_000);
    expect(MEDIA_COMPRESSION_LIMITS.maxEdge).toEqual({ min: 500, max: 4000 });
  });
});

describe("useMediaCompressionPolicy", () => {
  function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };
  }

  it("requests nothing when disabled and returns the code defaults", () => {
    const fetcher = vi.fn(async () => jsonResponse(publicSettingsBody(SETTINGS)));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { result } = renderHook(
      () =>
        useMediaCompressionPolicy({
          enabled: false,
          fetcher: fetcher as unknown as typeof fetch,
        }),
      { wrapper: wrapper(client) },
    );

    expect(result.current).toEqual(MEDIA_COMPRESSION_DEFAULTS);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("derives the live policy from the fetched public settings", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        publicSettingsBody({
          ...SETTINGS,
          "media.maxEdge": 1200,
          "media.quality": 0.9,
          "media.targetBytes": 900_000,
          "media.maxUploadBytes": 8 * 1024 * 1024,
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { result } = renderHook(
      () =>
        useMediaCompressionPolicy({ fetcher: fetcher as unknown as typeof fetch }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.maxEdge).toBe(1200));
    expect(result.current).toEqual({
      maxEdge: 1200,
      quality: 0.9,
      targetBytes: 900_000,
      maxUploadBytes: 8 * 1024 * 1024,
    });
  });
});