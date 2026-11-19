import type { ItineraryItem } from "@roamlog/contracts";
import { Badge, EmptyState, Skeleton } from "@roamlog/ui";
import { CheckCircle2, Clock3, MapPin } from "lucide-react";

import { formatLongDate } from "@/lib/trip-presentation";

export function TripFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-hairline pl-3">
      <p className="type-eyebrow">{label}</p>
      <p className="mt-1.5 text-sm text-ink">{value}</p>
    </div>
  );
}

export function ItineraryList({ items }: { items: ItineraryItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="还没有排定行程"
        description="行程条目接入写接口后会出现在这里；没有来源为空的行程不会被凭空补齐。"
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-card border border-hairline bg-surface-1 p-3.5"
        >
          <span className="flex size-8 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-muted">
            {item.done ? (
              <CheckCircle2 aria-hidden="true" className="size-4 text-accent-green" />
            ) : (
              <Clock3 aria-hidden="true" className="size-4" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={item.done ? "text-sm text-muted line-through" : "text-sm text-ink"}>
                {item.title}
              </p>
              <Badge tone="neutral">{item.type}</Badge>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
              <span>{formatLongDate(item.date)}</span>
              <span>
                {item.startTime
                  ? `${item.startTime}${item.endTime ? `–${item.endTime}` : ""}`
                  : "全天"}
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden="true" className="size-3" />
                {item.location}
              </span>
            </p>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
            {item.done ? "DONE" : "PLANNED"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DetailLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-56 rounded-card" />
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
