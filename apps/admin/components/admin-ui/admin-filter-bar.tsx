import type * as React from "react";

import { cn } from "../admin-shell/cn";

export function AdminFilterBar({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="search"
      className={cn(
        "flex flex-col gap-3 rounded-card border border-hairline bg-surface-1/70 p-3 md:flex-row md:items-end",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
