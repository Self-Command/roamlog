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
    <header className="flex flex-col gap-5 border-b border-hairline pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="type-eyebrow">{eyebrow}</p>
          {readOnly ? <Badge tone="slate">只读分析模式</Badge> : null}
        </div>
        <h1 className="mt-3 font-serif text-[clamp(2rem,1.7rem+0.8vw,2.5rem)] leading-tight tracking-[-0.035em] text-ink">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
