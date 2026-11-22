import { FONT_PAIRING_CATALOG, FONT_PAIRING_IDS, type FontPairingId } from "@roamlog/contracts";

export const fontVariableNames = {
  instrumentSerif: "--font-instrument",
  notoSerifSc: "--font-noto-serif",
  geistSans: "--font-geist",
  notoSansSc: "--font-noto-sans",
  geistMono: "--font-geist-mono",
  newsreader: "--font-newsreader",
  manrope: "--font-manrope",
  inter: "--font-inter",
  fraunces: "--font-fraunces",
  jetbrainsMono: "--font-jetbrains-mono",
} as const;

export const fontFamilyVariables = {
  serif: "var(--roamlog-font-serif)",
  sans: "var(--roamlog-font-sans)",
  mono: "var(--roamlog-font-mono)",
} as const;

export const DEFAULT_FONT_PAIRING_ID: FontPairingId = "editorial-classic";

interface FontPairingStacks {
  readonly displayStack: string;
  readonly bodyStack: string;
  readonly monoStack: string;
  readonly cjkFallback: string;
  readonly licenseFile: string;
  readonly licenseFiles: readonly string[];
}

const fontPairingStacks: Record<FontPairingId, FontPairingStacks> = {
  "editorial-classic": {
    displayStack: 'var(--font-instrument), var(--font-noto-serif), "Songti SC", "SimSun", serif',
    bodyStack: "var(--font-geist), var(--font-noto-sans), ui-sans-serif, system-ui, sans-serif",
    monoStack: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    cjkFallback: "Noto Serif SC / Noto Sans SC",
    licenseFile: "font-licenses/instrument-serif.txt",
    licenseFiles: [
      "font-licenses/instrument-serif.txt",
      "font-licenses/geist.txt",
      "font-licenses/geist-mono.txt",
      "font-licenses/noto-sans-sc.txt",
      "font-licenses/noto-serif-sc.txt",
    ],
  },
  "literary-warm": {
    displayStack: "var(--font-newsreader), var(--font-noto-serif), Georgia, serif",
    bodyStack: "var(--font-manrope), var(--font-noto-sans), ui-sans-serif, system-ui, sans-serif",
    monoStack: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
    cjkFallback: "Noto Serif SC / Noto Sans SC",
    licenseFile: "font-licenses/newsreader.txt",
    licenseFiles: [
      "font-licenses/newsreader.txt",
      "font-licenses/manrope.txt",
      "font-licenses/jetbrains-mono.txt",
      "font-licenses/noto-sans-sc.txt",
      "font-licenses/noto-serif-sc.txt",
    ],
  },
  "modern-editorial": {
    displayStack: 'var(--font-instrument), var(--font-noto-serif), "Songti SC", serif',
    bodyStack: "var(--font-inter), var(--font-noto-sans), ui-sans-serif, system-ui, sans-serif",
    monoStack: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    cjkFallback: "Noto Serif SC / Noto Sans SC",
    licenseFile: "font-licenses/inter.txt",
    licenseFiles: [
      "font-licenses/instrument-serif.txt",
      "font-licenses/inter.txt",
      "font-licenses/geist-mono.txt",
      "font-licenses/noto-sans-sc.txt",
      "font-licenses/noto-serif-sc.txt",
    ],
  },
  "expressive-serif": {
    displayStack: "var(--font-fraunces), var(--font-noto-serif), Georgia, serif",
    bodyStack: "var(--font-inter), var(--font-noto-sans), ui-sans-serif, system-ui, sans-serif",
    monoStack: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
    cjkFallback: "Noto Serif SC / Noto Sans SC",
    licenseFile: "font-licenses/fraunces.txt",
    licenseFiles: [
      "font-licenses/fraunces.txt",
      "font-licenses/inter.txt",
      "font-licenses/jetbrains-mono.txt",
      "font-licenses/noto-sans-sc.txt",
      "font-licenses/noto-serif-sc.txt",
    ],
  },
  "cjk-editorial": {
    displayStack: 'var(--font-noto-serif), "Songti SC", "SimSun", serif',
    bodyStack: 'var(--font-noto-sans), ui-sans-serif, system-ui, "PingFang SC", sans-serif',
    monoStack: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    cjkFallback: "Noto Serif SC / Noto Sans SC",
    licenseFile: "font-licenses/noto-serif-sc.txt",
    licenseFiles: [
      "font-licenses/noto-serif-sc.txt",
      "font-licenses/noto-sans-sc.txt",
      "font-licenses/geist-mono.txt",
    ],
  },
  "swiss-modern": {
    displayStack: "var(--font-geist), var(--font-noto-serif), ui-sans-serif, system-ui, sans-serif",
    bodyStack: "var(--font-geist), var(--font-noto-sans), ui-sans-serif, system-ui, sans-serif",
    monoStack: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
    cjkFallback: "Noto Serif SC / Noto Sans SC",
    licenseFile: "font-licenses/geist.txt",
    licenseFiles: [
      "font-licenses/geist.txt",
      "font-licenses/jetbrains-mono.txt",
      "font-licenses/noto-sans-sc.txt",
      "font-licenses/noto-serif-sc.txt",
    ],
  },
};

export interface FontPairingDefinition {
  readonly id: FontPairingId;
  readonly label: string;
  readonly description: string;
  readonly displayStack: string;
  readonly bodyStack: string;
  readonly monoStack: string;
  readonly cjkFallback: string;
  readonly licenseId: "OFL-1.1";
  readonly licenseSource: string;
  readonly licenseFile: string;
  readonly licenseFiles: readonly string[];
}

export const FONT_PAIRINGS: readonly FontPairingDefinition[] = FONT_PAIRING_CATALOG.map(
  (pairing) => ({
    ...pairing,
    ...fontPairingStacks[pairing.id],
  }),
);

export function normalizeFontPairingId(value: string | null | undefined): FontPairingId {
  return FONT_PAIRING_IDS.includes(value as FontPairingId)
    ? (value as FontPairingId)
    : DEFAULT_FONT_PAIRING_ID;
}

export function fontPairingById(value: string | null | undefined): FontPairingDefinition {
  const id = normalizeFontPairingId(value);
  const pairing = FONT_PAIRINGS.find((entry) => entry.id === id);
  if (!pairing) {
    throw new Error(`Missing font pairing catalog entry for ${id}`);
  }
  return pairing;
}

export interface FontPairingCssVariables {
  readonly "--roamlog-font-serif": string;
  readonly "--roamlog-font-sans": string;
  readonly "--roamlog-font-mono": string;
}

export function fontPairingCssVariables(value: string | null | undefined): FontPairingCssVariables {
  const pairing = fontPairingById(value);
  return {
    "--roamlog-font-serif": pairing.displayStack,
    "--roamlog-font-sans": pairing.bodyStack,
    "--roamlog-font-mono": pairing.monoStack,
  };
}

export const pageTitleMaximumPx = {
  page: 56,
  trip: 48,
  journal: 36,
} as const;

export const typography = {
  pageTitle: {
    className: "type-page-title",
    maxPx: pageTitleMaximumPx.page,
    lineHeight: 1.1,
  },
  tripTitle: {
    className: "type-trip-title",
    maxPx: pageTitleMaximumPx.trip,
    lineHeight: 1.1,
  },
  journalTitle: {
    className: "type-journal-title",
    maxPx: pageTitleMaximumPx.journal,
    lineHeight: 1.12,
  },
  eyebrow: {
    className: "type-eyebrow",
  },
  body: {
    className: "type-body",
  },
  meta: {
    className: "type-meta",
  },
} as const;

export const reduceMotionClassName = "reduce-motion";
