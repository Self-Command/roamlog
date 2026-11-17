import {
  Geist as GeistFont,
  Geist_Mono as GeistMonoFont,
  Instrument_Serif as InstrumentSerifFont,
  Noto_Sans_SC as NotoSansScFont,
  Noto_Serif_SC as NotoSerifScFont,
} from "next/font/google";

export const instrumentSerif = InstrumentSerifFont({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument",
});

export const notoSerifSc = NotoSerifScFont({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-serif",
});

export const geistSans = GeistFont({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

export const notoSansSc = NotoSansScFont({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans",
});

export const geistMono = GeistMonoFont({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

export const fontClassNames = [
  instrumentSerif.variable,
  notoSerifSc.variable,
  geistSans.variable,
  notoSansSc.variable,
  geistMono.variable,
].join(" ");
