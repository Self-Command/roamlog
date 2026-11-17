import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { fontClassNames } from "@/lib/fonts";

import { Providers } from "../components/providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Roamlog — 旅行档案",
    template: "%s · Roamlog",
  },
  description: "为旅行小队保存行程、日志、照片与共同记忆。",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" className={fontClassNames} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
