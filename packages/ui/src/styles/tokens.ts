export const designTokens = {
  canvas: "#000000",
  surface1: "#0a0a0c",
  surface2: "#101012",
  surfaceDeep: "#06060a",
  ink: "#fcfdff",
  body: "rgba(252,253,255,.86)",
  muted: "#a1a4a5",
  ash: "#888e90",
  stone: "#464a4d",
  hairline: "rgba(255,255,255,.06)",
  hairlineStrong: "rgba(255,255,255,.14)",
  divider: "rgba(255,255,255,.04)",
  accents: {
    orange: "#ff801f",
    blue: "#3b9eff",
    green: "#11ff99",
    red: "#ff2047",
    yellow: "#ffc53d",
    slate: "#64748b",
  },
  radii: {
    card: "12px",
    control: "8px",
    pill: "9999px",
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
