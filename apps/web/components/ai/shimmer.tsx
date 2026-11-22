"use client";

/**
 * Text shimmer, ported from vercel/chatbot `components/ai-elements/shimmer.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0), L27–L78.
 *
 * The upstream component drives `backgroundPosition` with `motion/react`:
 * `initial {0%?}` → `animate={{ backgroundPosition: "0% center" }}`,
 * `initial={{ backgroundPosition: "100% center" }}`, `repeat: Infinity`,
 * `duration` (default 2), `spread` (default 2) and
 * `dynamicSpread = children.length * spread` (L46–L49) fed into the
 * `linear-gradient(... calc(50% - var(--spread)) ..., calc(50% + var(--spread)) ...)`
 * band at L56.
 *
 * Adaptation layer: `motion/react` is not a dependency of this repo and the task
 * forbids adding one. The identical property set is applied with a plain CSS
 * animation (`ai-motion.tsx`) instead of Framer Motion; `--spread`, `duration`
 * and the geometry stay byte-compatible with upstream, only the driver changes.
 * The `memo` wrapper from L78 is kept.
 */

import type { CSSProperties, ElementType } from "react";
import { memo, useMemo } from "react";

import { cn } from "./cn";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * spread, [children, spread]);

  return (
    <Component
      className={cn("roamlog-ai-shimmer", className)}
      style={
        {
          "--bg": `linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--ink), transparent calc(50% + var(--spread)))`,
          "--spread": `${dynamicSpread}px`,
          animationDuration: `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
