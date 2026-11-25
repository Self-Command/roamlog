import type { ItineraryItem, Trip } from "@roamlog/contracts";
import { Badge, Skeleton } from "@roamlog/ui";
import { WalletCards } from "lucide-react";

import { formatBudget, tripDurationDays } from "@/lib/trip-presentation";

import { ItineraryList, TripFact } from "./trip-detail-parts";

interface TripDetailOverviewProps {
  trip: Trip;
  itinerary: ItineraryItem[];
  itineraryLoading: boolean;
}

export function TripDetailOverview({ trip, itinerary, itineraryLoading }: TripDetailOverviewProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
      <div className="space-y-4">
        <section className="surface-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">旅行摘要</p>
              <h2 className="mt-1.5 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                这趟旅行
              </h2>
            </div>
            <Badge tone="neutral">旅行资料</Badge>
          </div>
          <p className="mt-4 text-sm leading-7 text-body">{trip.summary}</p>
          <div className="mt-5 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-3">
            <TripFact
              label="旅行天数"
              value={`${tripDurationDays(trip.startDate, trip.endDate)} 天`}
            />
            <TripFact label="停靠点" value={`${trip.destinations.length} 站`} />
            <TripFact
              label="预算"
              value={formatBudget(trip.budgetAmountMinor, trip.budgetCurrency)}
            />
          </div>
        </section>

        <section className="surface-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-eyebrow">行程预览</p>
              <h2 className="mt-1.5 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                接下来
              </h2>
            </div>
            <Badge tone="blue">{itinerary.length} ITEMS</Badge>
          </div>
          <div className="mt-4">
            {itineraryLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 rounded-card" />
                <Skeleton className="h-16 rounded-card" />
              </div>
            ) : (
              <ItineraryList items={itinerary} />
            )}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="surface-card p-5">
          <p className="type-eyebrow">路线</p>
          <h2 className="mt-1.5 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
            路线
          </h2>
          <ol className="mt-4 space-y-3">
            {[trip.origin, ...trip.destinations].map((place, index) => (
              <li key={`${place}-${index}`} className="flex gap-3">
                <span className="relative flex size-6 shrink-0 items-center justify-center">
                  <span className="size-2 rounded-pill bg-ink" />
                  {index < trip.destinations.length ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-6 h-5 w-px -translate-x-1/2 bg-hairline-strong"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 pb-1">
                  <span className="block text-sm text-ink">{place}</span>
                  <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                    {index === 0 ? "出发地" : `停靠点 0${index}`}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="surface-card p-5">
          <div className="flex items-center gap-2">
            <WalletCards aria-hidden="true" className="size-4 text-accent-orange" />
            <p className="type-eyebrow">预算</p>
          </div>
          <p className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-ink">
            {formatBudget(trip.budgetAmountMinor, trip.budgetCurrency)}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            这是旅行预算设置，不等于实际花费。收支、分账和 settle-up 将在预算模块接入。
          </p>
        </section>
      </div>
    </div>
  );
}
