import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/providers", () => ({
  AdminProviders: ({ children }: { children: unknown }) => children,
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
  it("always renders the fixed dark operational shell", () => {
    const html = RootLayout({ children: null }) as ReactElement<RenderedHtmlProps>;

    expect(html.props["data-mode"]).toBe("dark");
    expect(html.props["data-theme"]).toBe("dark");
    expect(html.props["data-skin"]).toBe("editorial-noir");
    expect(html.props["data-font"]).toBe("editorial-classic");
    expect(html.props.style?.colorScheme).toBe("dark");
  });

  it("keeps the Admin stylesheet scoped to a fixed dark color scheme", () => {
    expect(globalsCss).toContain('html[data-mode="dark"]');
    expect(globalsCss).toContain("color-scheme: dark;");
  });
});
