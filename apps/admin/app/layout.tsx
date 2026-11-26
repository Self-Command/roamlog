import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "./globals.css";

import { AdminProviders } from "../components/providers";
import { ADMIN_APPEARANCE_COOKIE, adminAppearanceFromCookie } from "../lib/appearance";

export const metadata: Metadata = {
  title: {
    default: "Roamlog 管理后台",
    template: "%s · Roamlog 管理后台",
  },
  description: "Roamlog 平台运营控制台。",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#161616",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const appearance = adminAppearanceFromCookie(
    cookieStore.get(ADMIN_APPEARANCE_COOKIE)?.value,
  );
  const colorScheme = appearance.mode === "system" ? "light dark" : appearance.mode;

  return (
    <html
      lang="zh-CN"
      data-mode={appearance.mode}
      data-theme={appearance.mode}
      data-skin={appearance.skin}
      data-font={appearance.fontPairing}
      style={{ colorScheme }}
    >
      <body className="min-h-dvh bg-canvas text-body antialiased">
        <AdminProviders>{children}</AdminProviders>
      </body>
    </html>
  );
}
