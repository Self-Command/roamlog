import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";

import { fontClassNames } from "@/lib/fonts";
import {
  DEFAULT_LANGUAGE,
  buildSiteMetadata,
  getPublicSettings,
  readPublicString,
  resolveThemePresentation,
} from "@/lib/settings";

import { Providers } from "../components/providers";

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

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const settings = await getPublicSettings();
  const theme = resolveThemePresentation(settings);
  // Written during SSR, so the first paint already carries the runtime theme.
  const themeStyle = theme.style as CSSProperties;

  return (
    <html
      lang={readPublicString(settings, "general.defaultLanguage") ?? DEFAULT_LANGUAGE}
      className={fontClassNames}
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
