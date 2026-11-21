import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";

import {
  DEFAULT_LANGUAGE,
  buildSiteMetadata,
  getPublicSettings,
  readPublicString,
  resolveThemePresentation,
} from "@/lib/settings";

import { Providers } from "../components/providers";

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "./globals.css";

/**
 * Site metadata now comes from the runtime settings registry instead of a
 * build-time constant. Next memoizes the `fetch` inside `getPublicSettings()`
 * across `generateMetadata()` and the layout body, so a request performs one
 * read; the fetch's 30s revalidation is what makes an admin edit visible
 * without a rebuild.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata(await getPublicSettings());
}

/**
 * `color-scheme` mirrors the configured mode: `dark` for dark, `light dark` for
 * `system`. The UI itself still renders dark in both cases because
 * `@roamlog/ui` has only dark tokens; `light` is no longer a valid mode.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = resolveThemePresentation(await getPublicSettings());
  return {
    colorScheme: theme.colorScheme,
    themeColor: "#000000",
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const settings = await getPublicSettings();
  const theme = resolveThemePresentation(settings);
  // Written during SSR, so the first paint already carries the runtime theme.
  const themeStyle = theme.style as CSSProperties;

  return (
    <html
      lang={readPublicString(settings, "general.defaultLanguage") ?? DEFAULT_LANGUAGE}
      data-theme={theme.dataTheme}
      data-accent={theme.accent}
      style={themeStyle}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
