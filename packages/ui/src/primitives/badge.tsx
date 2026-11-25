import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-control border px-2 py-0.5 font-ui text-[11px] font-medium leading-4 tracking-normal",
  {
    variants: {
      tone: {
        neutral: "border-hairline bg-surface-2 text-body",
        orange: "border-accent-blue/25 bg-accent-blue/10 text-info",
        blue: "border-accent-blue/25 bg-accent-blue/10 text-info",
        green: "border-success/25 bg-success/10 text-success",
        red: "border-danger/25 bg-danger/10 text-danger",
        yellow: "border-warning/25 bg-warning/10 text-warning",
        slate: "border-hairline-strong bg-surface-2 text-muted",
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
