"use client";

import { Button, Skeleton } from "@roamlog/ui";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AsyncResult } from "./queries";

/** Panel chrome shared by every workspace tab: hairline card, mono meta, actions. */
export function Panel({
  title,
  meta,
  actions,
  children,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-serif text-lg leading-tight tracking-[-0.02em] text-ink">{title}</h2>
          {meta ? <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{meta}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Compact in-panel empty state — a workbench row, not a hero. */
export function EmptyBlock({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      {Icon ? (
        <span className="mb-3 flex size-9 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-muted">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      ) : null}
      <p className="font-serif text-xl leading-tight tracking-[-0.02em] text-ink">{title}</p>
      <p className="mt-1.5 max-w-md text-xs leading-5 text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-4 py-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function QueryError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="px-4 py-6" role="alert">
      <p className="font-serif text-lg leading-tight text-ink">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-muted">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

interface QueryPanelProps<T> {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  result: AsyncResult<T>;
  errorTitle: string;
  skeletonRows?: number;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * Panel + the three real states (loading / error+retry / empty) for one query.
 * Every tab uses this so no tab can forget a state.
 */
export function QueryPanel<T>({
  title,
  meta,
  actions,
  result,
  errorTitle,
  skeletonRows = 3,
  isEmpty,
  empty,
  children,
}: QueryPanelProps<T>) {
  return (
    <Panel title={title} meta={meta} actions={actions}>
      {result.state === "loading" ? (
        <SkeletonRows rows={skeletonRows} />
      ) : result.state === "error" ? (
        <QueryError title={errorTitle} message={result.error.message} onRetry={result.retry} />
      ) : isEmpty?.(result.data) && empty ? (
        <>{empty}</>
      ) : (
        <>{children(result.data)}</>
      )}
    </Panel>
  );
}

/** `LABEL / value` pair in mono, used by the header meta grid. */
export function MetaPair({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="type-eyebrow">{label}</p>
      <div className="mt-1 min-w-0 text-[13px] leading-5 text-ink">{children}</div>
      {hint ? <p className="mt-0.5 text-[10px] leading-4 text-stone">{hint}</p> : null}
    </div>
  );
}

export function Chips({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) {
    return <span className="font-mono text-[11px] text-stone">{empty}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-pill border border-hairline-strong bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-body"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}