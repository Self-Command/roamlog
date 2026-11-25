// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pageTitleMaximumPx } from "../styles/fonts";
import { designTokens } from "../styles/tokens";

const tokenCss = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

describe("Roamlog design tokens", () => {
  it("publishes semantic variable references and keeps the CSS source authoritative", () => {
    expect(designTokens).toMatchObject({
      canvas: "var(--canvas)",
      surface1: "var(--surface-1)",
      surface2: "var(--surface-2)",
      surfaceDeep: "var(--surface-deep)",
      surfaceOverlay: "var(--surface-overlay)",
      ink: "var(--ink)",
      muted: "var(--muted)",
      ash: "var(--ash)",
      stone: "var(--stone)",
      hairline: "var(--hairline)",
      focusRing: "var(--focus-ring)",
      danger: "var(--danger)",
    });

    expect(tokenCss).toContain("--canvas: light-dark(#ffffff, #292929);");
    expect(tokenCss).toContain("--surface-1: light-dark(#fafafa, #1f1f1f);");
    expect(tokenCss).toContain("--surface-2: light-dark(#f5f5f5, #141414);");
    expect(tokenCss).toContain("--surface-deep: light-dark(#f0f0f0, #0a0a0a);");
    expect(tokenCss).toContain("--ink: light-dark(#242424, #ffffff);");
  });

  it("publishes semantic accent references for restrained glows and data emphasis", () => {
    expect(designTokens.accents).toEqual({
      orange: "var(--accent-orange)",
      blue: "var(--accent-blue)",
      green: "var(--accent-green)",
      red: "var(--accent-red)",
      yellow: "var(--accent-yellow)",
      slate: "var(--accent-slate)",
    });

    expect(tokenCss).toContain("--accent-orange: light-dark(#0f6cbd, #115ea3);");
    expect(tokenCss).toContain("--accent-blue: light-dark(#115ea3, #479ef5);");
    expect(tokenCss).toContain("--accent-green: light-dark(#0e700e, #54b054);");
    expect(tokenCss).toContain("--accent-red: light-dark(#b10e1c, #dc626d);");
    expect(tokenCss).toContain("--accent-yellow: light-dark(#bc4b09, #faa06b);");
    expect(tokenCss).toContain("--accent-slate: light-dark(#707070, #999999);");
  });

  it("keeps the shared radii and font channels contract explicit", () => {
    expect(designTokens.radii).toEqual({
      card: "var(--roamlog-radius-card)",
      control: "var(--roamlog-radius-control)",
      pill: "9999px",
    });
    expect(tokenCss).toContain("--roamlog-radius-card: 8px;");
    expect(tokenCss).toContain("--roamlog-radius-control: 4px;");
    expect(tokenCss).toContain("--roamlog-radius-pill: 9999px;");
    expect(tokenCss).toContain("--font-serif:");
    expect(tokenCss).toContain("--font-sans:");
    expect(tokenCss).toContain("--font-display:");
    expect(tokenCss).toContain("--font-ui:");
    expect(tokenCss).toContain("--font-prose:");
    expect(tokenCss).toContain("--font-mono:");
  });

  it("caps title sizes and respects both reduced-motion signals", () => {
    expect(pageTitleMaximumPx).toEqual({
      page: 32,
      trip: 32,
      journal: 28,
    });
    expect(tokenCss).toContain("--roamlog-text-page-title: 2rem;");
    expect(tokenCss).toContain("--roamlog-text-trip-title: 2rem;");
    expect(tokenCss).toContain("--roamlog-text-journal-title: 1.75rem;");
    expect(tokenCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(tokenCss).toContain("html.reduce-motion");
  });
});
