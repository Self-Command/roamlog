import type { LucideIcon } from "lucide-react";

import { Badge } from "@roamlog/ui";

import { cn } from "../admin-shell/cn";

interface AdminMetricCardProps {
  label: string;
  value: string;
  detail: string;
  change?: string;
  tone?: "neutral" | "blue" | "green" | "orange" | "red";
  icon: LucideIcon;
  className?: string;
}

const toneClasses: Record<NonNullable<AdminMetricCardProps["tone"]>, string> = {
  neutral: "text-muted",
  blue: "text-accent-blue",
  green: "text-accent-green",
  orange: "text-accent-orange",
  red: "text-accent-red",
};

export function AdminMetricCard({
  label,
  value,
  detail,
  change,
  tone = "neutral",
  icon: Icon,
  className,
}: AdminMetricCardProps) {
  return (
    <article
      className={cn(
        "rounded-card border border-hairline-strong bg-surface-1 p-4 transition-colors hover:border-ash/60",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </p>
        <Icon aria-hidden="true" className={cn("size-4", toneClasses[tone])} />
      </div>
      <p className="mt-4 font-display text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
        {value}
      </p>
      <div className="mt-4 flex items-end justify-between gap-2 border-t border-hairline pt-3">
        <p className="text-[11px] leading-4 text-muted">{detail}</p>
        {change ? (
          <Badge tone={tone === "red" ? "red" : tone === "neutral" ? "neutral" : tone}>
            {change}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}
