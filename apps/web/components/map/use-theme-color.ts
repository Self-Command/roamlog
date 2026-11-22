"use client";

import { useEffect, useState } from "react";

/**
 * Resolve a CSS custom property to a concrete color for canvas APIs.
 *
 * MapLibre paint properties cannot consume CSS `var()` expressions, so the
 * value is resolved through a hidden probe element. The probe inherits the
 * document's `light-dark()` color scheme, and the hook re-resolves whenever the
 * appearance attributes or the OS color preference changes.
 */
export function resolveThemeColor(token: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }

  try {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const color = window.getComputedStyle(probe).color.trim();
    probe.remove();

    if (!color || color.startsWith("var(") || color === "rgba(0, 0, 0, 0)") {
      return fallback;
    }
    return color;
  } catch {
    return fallback;
  }
}

export function useThemeColor(token: string, fallback: string): string {
  const [color, setColor] = useState(() => resolveThemeColor(token, fallback));

  useEffect(() => {
    const update = () => setColor(resolveThemeColor(token, fallback));
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode", "data-skin", "data-font"],
    });

    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    media?.addEventListener("change", update);

    return () => {
      observer.disconnect();
      media?.removeEventListener("change", update);
    };
  }, [fallback, token]);

  return color;
}
