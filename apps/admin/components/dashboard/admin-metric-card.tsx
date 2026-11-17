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
        "rounded-card border border-hairline-strong bg-surface-1 p-5 transition-colors hover:border-white/20",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="type-eyebrow">{label}</p>
        <Icon aria-hidden="true" className={cn("size-4", toneClasses[tone])} />
      </div>
      <p className="mt-5 font-serif text-[2rem] leading-none tracking-[-0.035em] text-ink">
        {value}
      </p>
      <div className="mt-5 flex items-end justify-between gap-2 border-t border-hairline pt-3">
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
