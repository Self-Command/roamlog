import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fonts", () => ({ fontClassNames: "font-test" }));
vi.mock("@/components/providers", () => ({
  Providers: ({ children }: { children: unknown }) => children,
}));

import RootLayout from "@/app/layout";

interface RenderedHtmlProps {
  lang?: string;
  "data-theme"?: string;
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
  it("writes theme.accent and theme.defaultMode onto <html> during SSR", async () => {
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
    expect(html.props["data-accent"]).toBe("blue");
    expect(html.props.style?.["--accent-primary"]).toBe("#3b9eff");
    expect(html.props.style?.colorScheme).toBe("dark");
    expect(html.props.lang).toBe("zh-CN");
  });

  it("changes the rendered style when the accent setting changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => settingsResponse({ "theme.accent": "white" })));
    const first = await renderLayout();
    const whiteAccent = first.props.style?.["--accent-primary"];

    vi.stubGlobal("fetch", vi.fn(async () => settingsResponse({ "theme.accent": "rose" })));
    const second = await renderLayout();
    const roseAccent = second.props.style?.["--accent-primary"];

    expect(whiteAccent).toBe("#fcfdff");
    expect(roseAccent).toBe("#ff2047");
    expect(roseAccent).not.toBe(whiteAccent);
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
    expect(html.props["data-accent"]).toBe("white");
    expect(html.props.style?.colorScheme).toBe("light dark");
    expect(html.props.style?.["--accent-primary"]).toBe("#fcfdff");
    expect(JSON.stringify(html.props)).not.toMatch(/error|失败|异常|unavailable|加载失败/i);
  });
});