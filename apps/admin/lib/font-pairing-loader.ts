"use client";

import type { FontPairingId } from "@roamlog/contracts";

type LazyFontPairingId =
  | "carbon-plex"
  | "literary-warm"
  | "modern-editorial"
  | "expressive-serif"
  | "swiss-modern";

const loaders: Record<LazyFontPairingId, () => Promise<unknown>> = {
  "carbon-plex": () => import("./font-pairings/carbon-plex"),
  "literary-warm": () => import("./font-pairings/literary-warm"),
  "modern-editorial": () => import("./font-pairings/modern-editorial"),
  "expressive-serif": () => import("./font-pairings/expressive-serif"),
  "swiss-modern": () => import("./font-pairings/swiss-modern"),
};

/** Admin previews may request any Web pairing without loading it in the shell. */
export async function loadFontPairing(pairing: FontPairingId): Promise<void> {
  if (
    pairing === "primer-system" ||
    pairing === "primer-cjk" ||
    pairing === "fluent-native"
  ) {
    return;
  }
  const loader = loaders[pairing as LazyFontPairingId];
  if (loader) await loader();
}
