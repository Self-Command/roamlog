export const fontVariableNames = {
  instrumentSerif: "--font-instrument",
  notoSerifSc: "--font-noto-serif",
  geistSans: "--font-geist",
  notoSansSc: "--font-noto-sans",
  geistMono: "--font-geist-mono",
} as const;

export const fontFamilyVariables = {
  serif: "var(--roamlog-font-serif)",
  sans: "var(--roamlog-font-sans)",
  mono: "var(--roamlog-font-mono)",
} as const;

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
