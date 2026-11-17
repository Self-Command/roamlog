import type { CSSProperties, HTMLAttributes } from "react";

import { cn } from "../lib/cn";
import { accentGlowCssVariable, type AccentName } from "../styles/tokens";

export interface PageGlowProps extends HTMLAttributes<HTMLDivElement> {
  accent?: AccentName | "none";
}

export function PageGlow({ accent = "orange", className, style, ...props }: PageGlowProps) {
  if (accent === "none") {
    return null;
  }

  const glowStyle = {
    "--page-glow-color": accentGlowCssVariable(accent),
    ...style,
  } as CSSProperties;

  return (
    <div aria-hidden="true" className={cn("page-glow", className)} style={glowStyle} {...props} />
  );
}
