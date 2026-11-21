import type { Metadata } from "next";

import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "./globals.css";

import { AdminProviders } from "../components/providers";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-canvas text-body antialiased">
        <AdminProviders>{children}</AdminProviders>
      </body>
    </html>
  );
}
