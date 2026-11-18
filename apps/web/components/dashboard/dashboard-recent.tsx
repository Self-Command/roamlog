import type { Trip } from "@roamlog/contracts";
import { Badge, EmptyState } from "@roamlog/ui";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  formatBudget,
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
} from "@/lib/trip-presentation";

export function DashboardRecent({
  trips,
  workspaceSlug,
  currency,
}: {
  trips: Trip[];
  workspaceSlug: string;
  currency: string;
}) {
  const recentTrips = [...trips]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);
  const budgetedTrips = trips.filter(
    (trip) => trip.budgetAmountMinor !== null && trip.budgetCurrency === currency,
  );
  const maximumBudget = Math.max(1, ...budgetedTrips.map((trip) => trip.budgetAmountMinor ?? 0));

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className="rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <p className="type-eyebrow">RECENTLY UPDATED</p>
            <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">最近整理</h2>
          </div>
          <Link
            href={`/w/${workspaceSlug}/trips`}
            className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            全部旅行
          </Link>
        </div>

        <div className="divide-y divide-hairline">
          {recentTrips.map((trip) => (
            <Link
              key={trip.id}
              href={`/w/${workspaceSlug}/trips/${trip.id}`}
              className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ink"
            >
              <span className="flex size-9 items-center justify-center rounded-pill border border-hairline bg-surface-2 font-mono text-[9px] text-muted">
                {trip.countryCodes[0] ?? "—"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{trip.title}</span>
                <span className="mt-1 block truncate text-[10px] text-muted">
                  {formatDateRange(trip.startDate, trip.endDate)} · {trip.destinations.join(" / ")}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={getTripStatusTone(trip.status)}>
                  {getTripStatusLabel(trip.status)}
                </Badge>
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-3.5 text-stone transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="type-eyebrow">BUDGET SNAPSHOT</p>
            <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">预算分布</h2>
          </div>
          <Badge tone="slate">预算</Badge>
        </div>

        <div className="mt-5 space-y-4">
          {budgetedTrips.length > 0 ? (
            budgetedTrips.slice(0, 4).map((trip, index) => {
              const ratio = ((trip.budgetAmountMinor ?? 0) / maximumBudget) * 100;
              return (
                <div key={trip.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px]">
                    <span className="truncate text-muted">{trip.title}</span>
                    <span className="shrink-0 font-mono text-body">
                      {formatBudget(trip.budgetAmountMinor, trip.budgetCurrency)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-pill bg-white/8">
                    <div
                      aria-hidden="true"
                      className={
                        index % 2 === 0
                          ? "h-full rounded-pill bg-accent-orange/70"
                          : "h-full rounded-pill bg-accent-blue/70"
                      }
                      style={{ width: `${Math.max(6, ratio)}%` }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              className="px-4 py-8"
              title="还没有设置预算"
              description="为旅行填写预算后，这里会按真实设置值显示分布。"
            />
          )}
        </div>
        <p className="mt-5 border-t border-hairline pt-4 text-[10px] leading-5 text-stone">
          预算为旅行设置值，不代表实际支出。分布仅统计 {currency} 预算；实际支出与分类汇总见洞察页。
        </p>
      </section>
    </div>
  );
}
