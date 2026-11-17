// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pageTitleMaximumPx } from "../styles/fonts";
import { designTokens } from "../styles/tokens";

const tokenCss = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

describe("Roamlog design tokens", () => {
  it("publishes the exact core surface and text values", () => {
    expect(designTokens).toMatchObject({
      canvas: "#000000",
      surface1: "#0a0a0c",
      surface2: "#101012",
      surfaceDeep: "#06060a",
      ink: "#fcfdff",
      muted: "#a1a4a5",
      ash: "#888e90",
      stone: "#464a4d",
    });

    expect(tokenCss).toContain("--canvas: #000000;");
    expect(tokenCss).toContain("--surface-1: #0a0a0c;");
    expect(tokenCss).toContain("--surface-2: #101012;");
    expect(tokenCss).toContain("--surface-deep: #06060a;");
    expect(tokenCss).toContain("--ink: #fcfdff;");
  });

  it("publishes six accent values for restrained glows and data emphasis", () => {
    expect(designTokens.accents).toEqual({
      orange: "#ff801f",
      blue: "#3b9eff",
      green: "#11ff99",
      red: "#ff2047",
      yellow: "#ffc53d",
      slate: "#64748b",
    });

    expect(tokenCss).toContain("--accent-orange: #ff801f;");
    expect(tokenCss).toContain("--accent-blue: #3b9eff;");
    expect(tokenCss).toContain("--accent-green: #11ff99;");
    expect(tokenCss).toContain("--accent-red: #ff2047;");
    expect(tokenCss).toContain("--accent-yellow: #ffc53d;");
    expect(tokenCss).toContain("--accent-slate: #94a3b8;");
  });

  it("keeps the shared radii and font channels contract explicit", () => {
    expect(designTokens.radii).toEqual({
      card: "12px",
      control: "8px",
      pill: "9999px",
    });
    expect(tokenCss).toContain("--roamlog-radius-card: 12px;");
    expect(tokenCss).toContain("--roamlog-radius-control: 8px;");
    expect(tokenCss).toContain("--roamlog-radius-pill: 9999px;");
    expect(tokenCss).toContain("--font-serif:");
    expect(tokenCss).toContain("--font-sans:");
    expect(tokenCss).toContain("--font-mono:");
  });

  it("caps title sizes and respects both reduced-motion signals", () => {
    expect(pageTitleMaximumPx).toEqual({
      page: 56,
      trip: 48,
      journal: 36,
    });
    expect(tokenCss).toContain("--roamlog-text-page-title: clamp(2.75rem, 2rem + 2vw, 3.5rem);");
    expect(tokenCss).toContain("--roamlog-text-trip-title: clamp(2.5rem, 1.75rem + 1.8vw, 3rem);");
    expect(tokenCss).toContain(
      "--roamlog-text-journal-title: clamp(1.75rem, 1.25rem + 1.1vw, 2.25rem);",
    );
    expect(tokenCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(tokenCss).toContain("html.reduce-motion");
  });
});
