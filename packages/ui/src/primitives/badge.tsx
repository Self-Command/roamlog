import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 font-mono text-[10px] uppercase leading-none tracking-[0.1em]",
  {
    variants: {
      tone: {
        neutral: "border-hairline bg-surface-2 text-body",
        orange: "border-accent-orange/20 bg-accent-orange/10 text-accent-orange",
        blue: "border-accent-blue/20 bg-accent-blue/10 text-accent-blue",
        green: "border-accent-green/20 bg-accent-green/10 text-accent-green",
        red: "border-accent-red/20 bg-accent-red/10 text-accent-red",
        yellow: "border-accent-yellow/20 bg-accent-yellow/10 text-accent-yellow",
        slate: "border-accent-slate/20 bg-accent-slate/10 text-accent-slate",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
