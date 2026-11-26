import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/components/providers", () => ({
  Providers: ({ children }: { children: unknown }) => children,
}));

import RootLayout, { generateMetadata, generateViewport } from "@/app/layout";
import { themeColorsForSkin } from "@/lib/appearance";
import { DEFAULT_THEME_SKIN } from "@/lib/settings";

interface RenderedHtmlProps {
  lang?: string;
  "data-theme"?: string;
  "data-mode"?: string;
  "data-skin"?: string;
  "data-font"?: string;
  "data-accent"?: string;
  style?: Record<string, string>;
  children?: ReactElement;
}

function settingsResponse(settings: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      settings,
      generatedAt: "2026-11-19T00:00:00.000Z",
    }),
  } as Response;
}

/** The exact React element Next serializes for `<html>`, before hydration. */
async function renderLayout(): Promise<ReactElement<RenderedHtmlProps>> {
  return (await RootLayout({
    children: null,
  })) as ReactElement<RenderedHtmlProps>;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

describe("root layout runtime theme", () => {
  const defaultColors = themeColorsForSkin(DEFAULT_THEME_SKIN);

  it("writes the enterprise theme and mode onto <html> during SSR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        settingsResponse({
          "site.title": "Atlas Journal",
          "theme.accent": "blue",
          "theme.defaultMode": "dark",
        }),
      ),
    );

    const html = await renderLayout();

    expect(html.props["data-theme"]).toBe("dark");
    expect(html.props["data-mode"]).toBe("dark");
    expect(html.props["data-skin"]).toBe("carbon");
    expect(html.props["data-font"]).toBe("fluent-native");
    expect(html.props["data-accent"]).toBe("blue");
    expect(html.props.style?.["--accent-primary"]).toBeUndefined();
    expect(html.props.style?.colorScheme).toBe("dark");
    expect(html.props.lang).toBe("zh-CN");
  });

  it("does not let a legacy accent override the skin palette", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settingsResponse({ "theme.accent": "white" })),
    );
    const first = await renderLayout();
    const whiteAccent = first.props.style?.["--accent-primary"];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settingsResponse({ "theme.accent": "rose" })),
    );
    const second = await renderLayout();
    const roseAccent = second.props.style?.["--accent-primary"];

    expect(whiteAccent).toBeUndefined();
    expect(roseAccent).toBeUndefined();
  });

  it("renders an explicit light mode truthfully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settingsResponse({ "theme.defaultMode": "light" })),
    );

    const html = await renderLayout();

    expect(html.props["data-theme"]).toBe("light");
    expect(html.props["data-mode"]).toBe("light");
    expect(html.props.style?.colorScheme).toBe("light");
    expect(JSON.stringify(html.props)).toContain('"light"');
  });

  it("serves SEO metadata from the public settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        settingsResponse({
          "site.title": "Atlas Journal",
          "seo.titleTemplate": "%s · Atlas",
          "seo.descriptionTemplate": "Plan together, remember together.",
          "seo.ogImageUrl": "https://cdn.example.com/og.png",
          "seo.robots": "noindex,nofollow",
        }),
      ),
    );

    const metadata = await generateMetadata();

    expect(metadata.title).toEqual({ default: "Atlas Journal", template: "%s · Atlas" });
    expect(metadata.openGraph).toMatchObject({
      title: "Atlas Journal · Atlas",
      description: "Plan together, remember together.",
      images: [{ url: "https://cdn.example.com/og.png" }],
    });
    expect(metadata.robots).toBe("noindex,nofollow");
  });

  it("emits the matching color-scheme viewport for light, dark and system", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settingsResponse({ "theme.defaultMode": "light" })),
    );
    await expect(generateViewport()).resolves.toEqual({
      colorScheme: "light",
      themeColor: defaultColors.light,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settingsResponse({ "theme.defaultMode": "system" })),
    );
    await expect(generateViewport()).resolves.toEqual({
      colorScheme: "light dark",
      themeColor: [
        { media: "(prefers-color-scheme: light)", color: defaultColors.light },
        { media: "(prefers-color-scheme: dark)", color: defaultColors.dark },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => settingsResponse({ "theme.defaultMode": "dark" })),
    );
    await expect(generateViewport()).resolves.toEqual({
      colorScheme: "dark",
      themeColor: defaultColors.dark,
    });
  });

  it("renders built-in defaults and no error copy when the settings API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:4000");
      }),
    );

    const html = await renderLayout();

    expect(html.props["data-theme"]).toBe("system");
    expect(html.props["data-mode"]).toBe("system");
    expect(html.props["data-skin"]).toBe(DEFAULT_THEME_SKIN);
    expect(html.props["data-font"]).toBe("fluent-native");
    expect(html.props["data-accent"]).toBe("white");
    expect(html.props.style?.colorScheme).toBe("light dark");
    expect(html.props.style?.["--accent-primary"]).toBeUndefined();
    expect(JSON.stringify(html.props)).not.toMatch(/error|失败|异常|unavailable|加载失败/i);
  });
});
