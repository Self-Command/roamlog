import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AI_HIGHLIGHT_DEFAULT_COLOR } from "@/lib/editor/ai-highlight";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("journal and share appearance tokens", () => {
  it("uses the semantic selection role in journal prose", () => {
    const css = read("components/journal/journal-layout.css");

    expect(css).toContain("background: var(--selection);");
    expect(css).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255/i);
  });

  it("re-resolves the AI highlight from the active accent token", () => {
    expect(AI_HIGHLIGHT_DEFAULT_COLOR).toContain("var(--accent-blue)");
    expect(AI_HIGHLIGHT_DEFAULT_COLOR).toContain("color-mix");
    expect(AI_HIGHLIGHT_DEFAULT_COLOR).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });

  it("does not keep dark-only card gradients in journal/shared content", () => {
    const demo = read("lib/demo-format.ts");
    const journal = read("app/(app)/w/[workspaceSlug]/journal/journal-live.tsx");
    const share = read("components/share/share-article.tsx");

    for (const source of [demo, journal, share]) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(source).not.toMatch(/rgba?\(\s*255\s*,\s*255\s*,\s*255/i);
      expect(source).not.toMatch(/(?:text|bg|border)-(?:white|black)(?:\/\d+)?\b/);
    }
  });
});
