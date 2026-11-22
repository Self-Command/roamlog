"use client";

import type { FontPairingId } from "@roamlog/contracts";

type LazyFontPairingId = Exclude<FontPairingId, "editorial-classic" | "cjk-editorial">;

const loaders: Record<LazyFontPairingId, () => Promise<unknown>> = {
  "literary-warm": () => import("./font-pairings/literary-warm"),
  "modern-editorial": () => import("./font-pairings/modern-editorial"),
  "expressive-serif": () => import("./font-pairings/expressive-serif"),
  "swiss-modern": () => import("./font-pairings/swiss-modern"),
};

/**
 * The default pairing is part of the app shell. Other pairings are fetched only
 * when the appearance picker or a saved user preference actually needs them.
 */
export async function loadFontPairing(pairing: FontPairingId): Promise<void> {
  if (pairing === "editorial-classic" || pairing === "cjk-editorial") {
    return;
  }
  await loaders[pairing]();
}
