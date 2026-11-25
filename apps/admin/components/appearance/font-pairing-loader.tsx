"use client";

import type { FontPairingId } from "@roamlog/contracts";
import { useEffect } from "react";

import { loadFontPairing } from "@/lib/font-pairing-loader";

export function FontPairingLoader({ pairing = "fluent-native" }: { pairing?: FontPairingId }) {
  useEffect(() => {
    void loadFontPairing(pairing);
  }, [pairing]);

  return null;
}
