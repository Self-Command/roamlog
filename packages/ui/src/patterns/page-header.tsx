import * as React from "react";

import { cn } from "../lib/cn";

const titleClasses = {
  page: "type-page-title",
  trip: "type-trip-title",
  journal: "type-journal-title",
} as const;

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  titleAs?: "h1" | "h2";
  titleSize?: keyof typeof titleClasses;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleAs: Title = "h1",
  titleSize = "page",
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-hairline pb-5 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <p className="type-eyebrow">{eyebrow}</p> : null}
        <Title className={cn(titleClasses[titleSize], eyebrow ? "mt-2" : "mt-0")}>{title}</Title>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">{actions}</div>
      ) : null}
    </div>
  );
}
