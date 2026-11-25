import { AlertTriangle, type LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-strong bg-surface-1 px-6 py-14 text-center",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <span className="mb-4 flex size-10 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-muted">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      ) : null}
      <h3 className="font-display text-2xl leading-tight tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: string;
  description?: string;
  retryAction?: React.ReactNode;
}

export function ErrorState({
  title = "暂时无法加载",
  description = "请稍后重试。如果问题持续，请刷新页面。",
  retryAction,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-accent-red/20 bg-accent-red/5 px-6 py-14 text-center",
        className,
      )}
      {...props}
    >
      <span className="mb-4 flex size-10 items-center justify-center rounded-pill border border-accent-red/20 bg-accent-red/10 text-accent-red">
        <AlertTriangle aria-hidden="true" className="size-4" />
      </span>
      <h3 className="font-display text-2xl leading-tight tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{description}</p>
      {retryAction ? <div className="mt-5">{retryAction}</div> : null}
    </div>
  );
}
