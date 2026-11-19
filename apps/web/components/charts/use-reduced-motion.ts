"use client";

import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Component-level `prefers-reduced-motion` listener.
 *
 * This is the third of the three motion guards required by the chart motion
 * spec: Recharts 3 `isAnimationActive="auto"` (library level) + the
 * `prefers-reduced-motion` media query in `charts-motion.css` (CSS level) +
 * this hook (component level, so JS-driven chart animations can be switched
 * off explicitly and the entrance class can be dropped entirely).
 *
 * Starts as `false` and syncs after mount so server and client markup match;
 * an environment without `matchMedia` (jsdom, older embedded webviews) simply
 * keeps the non-reduced default.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(query.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}
