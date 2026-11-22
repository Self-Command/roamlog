"use client";

import type { FontPairingId } from "@roamlog/contracts";

type LazyFontPairingId = Exclude<FontPairingId, "editorial-classic" | "cjk-editorial">;

const loaders: Record<LazyFontPairingId, () => Promise<unknown>> = {
  "literary-warm": () => import("./font-pairings/literary-warm"),
  "modern-editorial": () => import("./font-pairings/modern-editorial"),
  "expressive-serif": () => import("./font-pairings/expressive-serif"),
  "swiss-modern": () => import("./font-pairings/swiss-modern"),
};

/** Admin previews may request any Web pairing without loading it in the shell. */
export async function loadFontPairing(pairing: FontPairingId): Promise<void> {
  if (pairing === "editorial-classic" || pairing === "cjk-editorial") {
    return;
  }
  await loaders[pairing]();
}
