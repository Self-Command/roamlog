import {
  DEFAULT_FONT_PAIRING_ID,
  FONT_PAIRING_CATALOG,
  normalizeFontPairingId,
  type FontPairingId,
} from "@roamlog/contracts";

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
  monaSans: "--font-mona-sans",
  ibmPlexSans: "--font-ibm-plex-sans",
  ibmPlexMono: "--font-ibm-plex-mono",
} as const;

export const fontFamilyVariables = {
  display: "var(--roamlog-font-display)",
  ui: "var(--roamlog-font-ui)",
  prose: "var(--roamlog-font-prose)",
  serif: "var(--roamlog-font-serif)",
  sans: "var(--roamlog-font-sans)",
  mono: "var(--roamlog-font-mono)",
} as const;

interface FontPairingStacks {
  readonly displayStack: string;
  readonly bodyStack: string;
  readonly proseStack?: string;
  readonly monoStack: string;
  readonly cjkFallback: string;
  readonly licenseFile: string;
  readonly licenseFiles: readonly string[];
}

const fontPairingStacks: Record<FontPairingId, FontPairingStacks> = {
  "primer-system": {
    displayStack:
      'var(--font-mona-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", var(--font-noto-sans), "Noto Sans SC", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    bodyStack:
      'var(--font-mona-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", var(--font-noto-sans), "Noto Sans SC", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    proseStack:
      'var(--font-instrument), var(--font-noto-serif), "Songti SC", "SimSun", serif',
    monoStack:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    cjkFallback: "Noto Sans SC",
    licenseFile: "font-licenses/mona-sans.txt",
    licenseFiles: [
      "font-licenses/mona-sans.txt",
      "font-licenses/noto-sans-sc.txt",
    ],
  },
  "primer-cjk": {
    displayStack:
      'var(--font-noto-sans), "Noto Sans SC", ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    bodyStack:
      'var(--font-noto-sans), "Noto Sans SC", ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    proseStack: 'var(--font-noto-serif), "Noto Serif SC", "Songti SC", "SimSun", serif',
    monoStack:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    cjkFallback: "Noto Sans SC",
    licenseFile: "font-licenses/noto-sans-sc.txt",
    licenseFiles: ["font-licenses/noto-sans-sc.txt"],
  },
  "fluent-native": {
    displayStack:
      '"Segoe UI", -apple-system, BlinkMacSystemFont, var(--font-noto-sans), "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", sans-serif',
    bodyStack:
      '"Segoe UI", -apple-system, BlinkMacSystemFont, var(--font-noto-sans), "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", sans-serif',
    proseStack:
      'var(--font-newsreader), var(--font-noto-serif), "Songti SC", "SimSun", serif',
    monoStack: 'Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, monospace',
    cjkFallback: "System CJK / Noto Sans SC",
    licenseFile: "font-licenses/fluent-system.txt",
    licenseFiles: ["font-licenses/fluent-system.txt"],
  },
  "carbon-plex": {
    displayStack:
      'var(--font-ibm-plex-sans), var(--font-noto-sans), "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    bodyStack:
      'var(--font-ibm-plex-sans), var(--font-noto-sans), "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
    proseStack:
      'var(--font-newsreader), var(--font-noto-serif), "Songti SC", "SimSun", serif',
    monoStack:
      'var(--font-ibm-plex-mono), "IBM Plex Mono", var(--font-noto-sans), ui-monospace, SFMono-Regular, monospace',
    cjkFallback: "Noto Sans SC",
    licenseFile: "font-licenses/ibm-plex-sans.txt",
    licenseFiles: [
      "font-licenses/ibm-plex-sans.txt",
      "font-licenses/ibm-plex-mono.txt",
      "font-licenses/noto-sans-sc.txt",
    ],
  },
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
  readonly proseStack: string;
  readonly monoStack: string;
  readonly cjkFallback: string;
  readonly licenseId: "OFL-1.1" | "system";
  readonly licenseSource: string;
  readonly licenseFile: string;
  readonly licenseFiles: readonly string[];
}

export const FONT_PAIRINGS: readonly FontPairingDefinition[] = FONT_PAIRING_CATALOG.map(
  (pairing) => {
    const stacks = fontPairingStacks[pairing.id];
    return {
      ...pairing,
      ...stacks,
      proseStack:
        stacks.proseStack ??
        'var(--font-instrument), var(--font-noto-serif), "Songti SC", "SimSun", serif',
    };
  },
);

export { DEFAULT_FONT_PAIRING_ID, normalizeFontPairingId };

export function fontPairingById(value: string | null | undefined): FontPairingDefinition {
  const exact = FONT_PAIRINGS.find((entry) => entry.id === value);
  const id = normalizeFontPairingId(value);
  const pairing = exact ?? FONT_PAIRINGS.find((entry) => entry.id === id);
  if (!pairing) {
    throw new Error(`Missing font pairing catalog entry for ${id}`);
  }
  return pairing;
}

export interface FontPairingCssVariables {
  readonly "--roamlog-font-serif": string;
  readonly "--roamlog-font-sans": string;
  readonly "--roamlog-font-display": string;
  readonly "--roamlog-font-ui": string;
  readonly "--roamlog-font-prose": string;
  readonly "--roamlog-font-mono": string;
}

export function fontPairingCssVariables(value: string | null | undefined): FontPairingCssVariables {
  const pairing = fontPairingById(value);
  return {
    "--roamlog-font-serif": pairing.proseStack,
    "--roamlog-font-sans": pairing.bodyStack,
    "--roamlog-font-display": pairing.displayStack,
    "--roamlog-font-ui": pairing.bodyStack,
    "--roamlog-font-prose": pairing.proseStack,
    "--roamlog-font-mono": pairing.monoStack,
  };
}

export const pageTitleMaximumPx = {
  page: 32,
  trip: 32,
  journal: 28,
} as const;

export const typography = {
  pageTitle: {
    className: "type-page-title",
    maxPx: pageTitleMaximumPx.page,
    lineHeight: 1.5,
  },
  tripTitle: {
    className: "type-trip-title",
    maxPx: pageTitleMaximumPx.trip,
    lineHeight: 1.5,
  },
  journalTitle: {
    className: "type-journal-title",
    maxPx: pageTitleMaximumPx.journal,
    lineHeight: 1.3,
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
