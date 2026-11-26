import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/providers", () => ({
  AdminProviders: ({ children }: { children: unknown }) => children,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

import RootLayout from "./layout";

const globalsCss = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

interface RenderedHtmlProps {
  "data-mode"?: string;
  "data-theme"?: string;
  "data-skin"?: string;
  "data-font"?: string;
  style?: Record<string, string>;
}

describe("admin root layout", () => {
  it("renders the platform default shell when no appearance cookie exists", async () => {
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => undefined,
    } as never);
    const html = (await RootLayout({ children: null })) as ReactElement<RenderedHtmlProps>;

    expect(html.props["data-mode"]).toBe("system");
    expect(html.props["data-theme"]).toBe("system");
    expect(html.props["data-skin"]).toBe("mist");
    expect(html.props["data-font"]).toBe("fluent-native");
    expect(html.props.style?.colorScheme).toBe("light dark");
  });

  it("honors the shared appearance cookie on first paint", async () => {
    vi.mocked(cookies).mockResolvedValueOnce({
      get: () => ({
        value: encodeURIComponent(
          JSON.stringify({ v: 1, mode: "light", skin: "porcelain" }),
        ),
      }),
    } as never);
    const html = (await RootLayout({ children: null })) as ReactElement<RenderedHtmlProps>;

    expect(html.props["data-mode"]).toBe("light");
    expect(html.props["data-theme"]).toBe("light");
    expect(html.props["data-skin"]).toBe("porcelain");
    expect(html.props.style?.colorScheme).toBe("light");
  });

  it("keeps the Admin stylesheet dark-mode color-scheme override", () => {
    expect(globalsCss).toContain('html[data-mode="dark"]');
    expect(globalsCss).toContain("color-scheme: dark;");
  });
});
