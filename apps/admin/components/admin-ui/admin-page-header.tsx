import type * as React from "react";

import { Badge } from "@roamlog/ui";

interface AdminPageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  readOnly?: boolean;
  actions?: React.ReactNode;
}

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  readOnly = false,
  actions,
}: AdminPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-hairline pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            {eyebrow}
          </p>
          {readOnly ? <Badge tone="slate">只读分析模式</Badge> : null}
        </div>
        <h1 className="mt-2 font-display text-[32px] font-semibold leading-10 tracking-[-0.025em] text-ink">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-5 text-muted">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
