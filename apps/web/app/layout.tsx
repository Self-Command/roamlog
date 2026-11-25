import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";

import {
  DEFAULT_LANGUAGE,
  buildSiteMetadata,
  getPublicSettings,
  readPublicString,
  resolveThemePresentation,
} from "@/lib/settings";
import { getResolvedAppearance, themeColorsForSkin } from "@/lib/appearance";

import { Providers } from "../components/providers";

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource-variable/mona-sans/wght.css";
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
 * `color-scheme` mirrors the configured mode. The appearance token rollout
 * supplies the matching light/dark palettes; `system` emits `light dark` so
 * native controls follow the operating system until hydration.
 */
export async function generateViewport(): Promise<Viewport> {
  const [settings, appearance] = await Promise.all([getPublicSettings(), getResolvedAppearance()]);
  const theme = resolveThemePresentation(settings, appearance);
  const colors = themeColorsForSkin(theme.skin);
  return {
    colorScheme: theme.colorScheme,
    themeColor:
      theme.mode === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: colors.light },
            { media: "(prefers-color-scheme: dark)", color: colors.dark },
          ]
        : theme.mode === "light"
          ? colors.light
          : colors.dark,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [settings, appearance] = await Promise.all([getPublicSettings(), getResolvedAppearance()]);
  const theme = resolveThemePresentation(settings, appearance);
  // Written during SSR, so the first paint already carries the runtime theme.
  const themeStyle = theme.style as CSSProperties;

  return (
    <html
      lang={readPublicString(settings, "general.defaultLanguage") ?? DEFAULT_LANGUAGE}
      data-theme={theme.dataTheme}
      data-mode={theme.mode}
      data-accent={theme.accent}
      data-skin={theme.dataSkin}
      data-font={theme.dataFont}
      style={themeStyle}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
