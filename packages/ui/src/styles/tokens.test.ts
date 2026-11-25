// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SKIN_PALETTES,
  THEME_CONTRAST_PAIRS,
  THEME_SKINS,
  THEME_TOKEN_ROLES,
  type SkinPalette,
  type ThemeModeId,
} from "./theme-catalog";

const tokenCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const ACTIVE_THEME_SKINS = ["porcelain", "primer", "fluent", "carbon", "carbon-soft"] as const;

const paletteVariableNames: Record<string, string> = {
  canvas: "canvas",
  surface1: "surface-1",
  surface2: "surface-2",
  surfaceDeep: "surface-deep",
  overlay: "overlay",
  ink: "ink",
  body: "body",
  muted: "muted",
  ash: "ash",
  stone: "stone",
  accentWarm: "accent-warm",
  accentBlue: "accent-blue",
  accentGreen: "accent-green",
  accentRed: "accent-red",
  accentYellow: "accent-yellow",
  accentSlate: "accent-slate",
  accentContrast: "accent-contrast",
  focusRing: "focus-ring",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
};

function skinBlock(skin: (typeof THEME_SKINS)[number]): string {
  const match = new RegExp(String.raw`\[data-skin="${skin}"\]\s*\{([^}]*)\}`, "u").exec(tokenCss);
  if (!match) {
    throw new Error(`Missing CSS block for skin ${skin}`);
  }
  return match[1] ?? "";
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    channel(Number.parseInt(value.slice(offset, offset + 2), 16)),
  );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(left: string, right: string): number {
  const lighter = Math.max(luminance(left), luminance(right));
  const darker = Math.min(luminance(left), luminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function paletteRole(
  palette: SkinPalette,
  role: (typeof THEME_CONTRAST_PAIRS)[number][0] | (typeof THEME_CONTRAST_PAIRS)[number][1],
): string {
  switch (role) {
    case "canvas":
      return palette.canvas;
    case "surface-1":
      return palette.surface1;
    case "ink":
      return palette.ink;
    case "body":
      return palette.body;
    case "muted":
      return palette.muted;
    case "accent-solid":
      return palette.accentWarm;
    case "accent-contrast":
      return palette.accentContrast;
    case "focus-ring":
      return palette.focusRing;
    case "danger":
      return palette.danger;
    case "success":
      return palette.success;
    case "warning":
      return palette.warning;
    default:
      throw new Error(`Unknown contrast role ${String(role)}`);
  }
}

describe("six-skin semantic token system", () => {
  it("publishes every catalog palette in CSS as a light-dark pair", () => {
    for (const skin of THEME_SKINS) {
      const block = skinBlock(skin);
      for (const [field, variable] of Object.entries(paletteVariableNames)) {
        const palette = SKIN_PALETTES[skin];
        const expected = `--skin-${variable}: light-dark(${palette.light[field as keyof SkinPalette]}, ${palette.dark[field as keyof SkinPalette]});`;
        expect(block, `${skin} ${field}`).toContain(expected);
      }
    }
  });

  it("maps every semantic role once from the skin palette layer", () => {
    const mapping = /\[data-skin\]\s*\{([^}]*)\}/u.exec(tokenCss)?.[1] ?? "";
    for (const role of THEME_TOKEN_ROLES) {
      expect(mapping, role).toContain(`--${role}:`);
    }
  });

  it("ports the enterprise surface, radius, shadow and focus roles", () => {
    for (const skin of ACTIVE_THEME_SKINS) {
      const block = skinBlock(skin);
      const palette = SKIN_PALETTES[skin];
      for (const field of [
        "accentPrimary",
        "hairline",
        "hairlineStrong",
        "focusRingOuter",
        "focusRingInner",
      ] as const) {
        const variable = field
          .replace(/([A-Z])/gu, (letter) => `-${letter.toLowerCase()}`);
        expect(block, `${skin} ${field}`).toContain(
          `--skin-${variable}: light-dark(${palette.light[field]}, ${palette.dark[field]});`,
        );
      }
      expect(block).toContain(`--skin-radius-card: ${palette.light.radiusCard};`);
      expect(block).toContain(`--skin-radius-control: ${palette.light.radiusControl};`);
      expect(tokenCss).toContain(palette.light.shadowCard);
      expect(tokenCss).toContain(palette.dark.shadowCard);
      expect(tokenCss).toContain(palette.light.shadowOverlay);
      expect(tokenCss).toContain(palette.dark.shadowOverlay);
    }
  });

  it("makes system mode follow the OS color scheme", () => {
    expect(tokenCss).toContain('[data-mode="system"] {\n  color-scheme: light dark;');
    expect(tokenCss).toContain('[data-mode="light"] {\n  color-scheme: light;');
    expect(tokenCss).toContain('[data-mode="dark"] {\n  color-scheme: dark;');
    for (const skin of THEME_SKINS) {
      expect(skinBlock(skin)).toContain("light-dark(");
    }
  });

  it("meets WCAG AA for every catalog contrast pair", () => {
    const failures: string[] = [];
    for (const skin of THEME_SKINS) {
      for (const mode of ["light", "dark"] satisfies ThemeModeId[]) {
        const palette = SKIN_PALETTES[skin][mode];
        for (const [index, [left, right]] of THEME_CONTRAST_PAIRS.entries()) {
          const ratio = contrast(paletteRole(palette, left), paletteRole(palette, right));
          const minimum = index < 4 ? 4.5 : 3;
          if (ratio < minimum) {
            failures.push(`${skin}/${mode} ${left}↔${right}: ${ratio.toFixed(2)} < ${minimum}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
