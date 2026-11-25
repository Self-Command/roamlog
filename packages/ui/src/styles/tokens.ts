export const designTokens = {
  canvas: "var(--canvas)",
  surface1: "var(--surface-1)",
  surface2: "var(--surface-2)",
  surfaceDeep: "var(--surface-deep)",
  surfaceOverlay: "var(--surface-overlay)",
  ink: "var(--ink)",
  body: "var(--body)",
  muted: "var(--muted)",
  ash: "var(--ash)",
  stone: "var(--stone)",
  hairline: "var(--hairline)",
  hairlineStrong: "var(--hairline-strong)",
  divider: "var(--divider)",
  accentSolid: "var(--accent-solid)",
  accentPrimary: "var(--accent-primary)",
  accentSoft: "var(--accent-soft)",
  accentContrast: "var(--accent-contrast)",
  focusRing: "var(--focus-ring)",
  focusRingOuter: "var(--focus-ring-outer)",
  focusRingInner: "var(--focus-ring-inner)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
  chart1: "var(--chart-1)",
  chart2: "var(--chart-2)",
  chart3: "var(--chart-3)",
  chart4: "var(--chart-4)",
  chart5: "var(--chart-5)",
  chart6: "var(--chart-6)",
  mapRoute: "var(--map-route)",
  mapMarker: "var(--map-marker)",
  selection: "var(--selection)",
  accents: {
    orange: "var(--accent-orange)",
    blue: "var(--accent-blue)",
    green: "var(--accent-green)",
    red: "var(--accent-red)",
    yellow: "var(--accent-yellow)",
    slate: "var(--accent-slate)",
  },
  radii: {
    card: "var(--roamlog-radius-card)",
    control: "var(--roamlog-radius-control)",
    pill: "9999px",
  },
  shadows: {
    card: "var(--shadow-card)",
    overlay: "var(--shadow-overlay)",
  },
} as const;

export type AccentName = keyof typeof designTokens.accents;

export const accentNames = Object.keys(designTokens.accents) as AccentName[];

export function accentCssVariable(accent: AccentName): string {
  return `var(--accent-${accent})`;
}

export function accentGlowCssVariable(accent: AccentName): string {
  return `var(--glow-${accent})`;
}

export {
  SKIN_LABELS,
  SKIN_PALETTES,
  SKIN_SOURCES,
  THEME_CONTRAST_PAIRS,
  THEME_SKINS,
  THEME_TOKEN_ROLES,
} from "./theme-catalog";
export type { SkinPalette, ThemeModeId, ThemeSkinId } from "./theme-catalog";
