import * as React from "react";

import { cn } from "../lib/cn";

export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("animate-pulse rounded-control bg-surface-2", className)}
      {...props}
      aria-hidden="true"
    />
  ),
);

Skeleton.displayName = "Skeleton";
