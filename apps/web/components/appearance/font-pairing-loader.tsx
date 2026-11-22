"use client";

import type { FontPairingId } from "@roamlog/contracts";
import { useEffect } from "react";

import { loadFontPairing } from "@/lib/font-pairing-loader";

export function FontPairingLoader({ pairing = "editorial-classic" }: { pairing?: FontPairingId }) {
  useEffect(() => {
    void loadFontPairing(pairing);
  }, [pairing]);

  return null;
}
