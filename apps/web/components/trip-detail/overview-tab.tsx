"use client";

import type { JournalEntry, Trip } from "@roamlog/contracts";
import { Badge, Button } from "@roamlog/ui";
import {
  ArrowUpRight,
  CalendarRange,
  MapPin,
  NotebookPen,
  ReceiptText,
  Route,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { formatMinor, gradientFor, shortDate, weatherLabels } from "@/lib/demo-format";
import { formatDateRange, tripDurationDays } from "@/lib/trip-presentation";

import { JournalEntrySheet } from "@/components/journal/journal-entry-sheet";

export function TripOverviewTab({ trip }: { trip: Trip }) {
  const { state } = useDemoStore();
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const entries = useMemo(
    () =>
      state.entries
        .filter((entry) => entry.tripId === trip.id)
        .sort((left, right) => right.date.localeCompare(left.date)),
    [state.entries, trip.id],
  );
  const photos = state.media.filter((media) => media.tripId === trip.id).slice(0, 4);
  const expenses = state.expenses.filter((expense) => expense.tripId === trip.id);
  const spent = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const itinerary = state.itinerary
    .filter((item) => item.tripId === trip.id && !item.done)
    .sort((left, right) => left.date.localeCompare(right.date));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
      <div className="space-y-4">
        <section className="surface-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">TRIP NOTE</p>
              <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">这趟旅行</h2>
            </div>
            <Badge tone="blue">{entries.length} NOTES</Badge>
          </div>
          <p className="mt-4 text-sm leading-7 text-body">{trip.summary}</p>
          <div className="mt-5 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-4">
            {[
              {
                icon: CalendarRange,
                label: "DURATION",
                value: `${tripDurationDays(trip.startDate, trip.endDate)} 天`,
              },
              { icon: MapPin, label: "STOPS", value: `${trip.destinations.length} 站` },
              { icon: NotebookPen, label: "JOURNAL", value: `${entries.length} 篇` },
              {
                icon: ReceiptText,
                label: "PHOTOS",
                value: `${photos.length} 帧`,
              },
            ].map((fact) => (
              <div key={fact.label} className="flex items-start gap-2">
                <fact.icon aria-hidden="true" className="mt-0.5 size-3.5 text-muted" />
                <div>
                  <p className="type-eyebrow">{fact.label}</p>
                  <p className="mt-1 text-sm text-ink">{fact.value}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card overflow-hidden">
          <div className="flex items-end justify-between gap-4 border-b border-hairline p-5">
            <div>
              <p className="type-eyebrow">FEATURED NOTES</p>
              <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">最近写下的</h2>
            </div>
            <span className="font-mono text-[9px] uppercase text-stone">MOCK DATA</span>
          </div>
          <div className="divide-y divide-hairline">
            {entries.slice(0, 3).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelected(entry)}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-surface-2"
              >
                <div
                  className={`size-14 shrink-0 rounded-control border border-hairline-strong bg-gradient-to-br ${gradientFor(entry.id)}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-xl text-ink">{entry.title}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                    {shortDate(entry.date)} · {entry.location} · {weatherLabels[entry.weather ?? "cloudy"]}
                  </p>
                </div>
                <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="surface-card p-5">
          <div className="flex items-center gap-2">
            <WalletCards aria-hidden="true" className="size-4 text-accent-orange" />
            <p className="type-eyebrow">BUDGET SNAPSHOT</p>
          </div>
          <p className="mt-3 font-serif text-3xl tracking-[-0.03em] text-ink">
            {formatMinor(spent, trip.budgetCurrency ?? "CNY")}
          </p>
          <p className="mt-1 text-xs text-muted">
            已记录 {expenses.length} 笔 · 预算 {formatMinor(trip.budgetAmountMinor ?? 0, trip.budgetCurrency ?? "CNY")}
          </p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-pill bg-white/5">
            <div
              className="h-full rounded-pill bg-accent-orange"
              style={{
                width: `${Math.min(100, (spent / Math.max(trip.budgetAmountMinor ?? 1, 1)) * 100)}%`,
              }}
            />
          </div>
        </section>

        <section className="surface-card p-5">
          <p className="type-eyebrow">UP NEXT</p>
          <h2 className="mt-1.5 font-serif text-2xl text-ink">下一段安排</h2>
          <div className="mt-3 space-y-2">
            {itinerary.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-control border border-hairline bg-surface-2 p-2.5"
              >
                <Route aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-green" />
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-ink">{item.title}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-stone">
                    {shortDate(item.date)} · {item.startTime ?? "全天"} · {item.location}
                  </p>
                </div>
              </div>
            ))}
            {!itinerary.length ? <p className="text-xs text-muted">行程已全部完成。</p> : null}
          </div>
        </section>

        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="type-eyebrow">RECENT FRAMES</p>
              <h2 className="mt-1 font-serif text-xl text-ink">最近照片</h2>
            </div>
            <Badge tone="neutral">{photos.length}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-px bg-hairline">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className={`relative aspect-square bg-gradient-to-br ${gradientFor(photo.id)}`}
              >
                <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-[9px] leading-4 text-white/65">
                  {photo.caption}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-card border border-hairline bg-surface-1 p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
            {formatDateRange(trip.startDate, trip.endDate)} · {trip.origin} →{" "}
            {trip.destinations.join(" → ")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 w-full"
            onClick={() => entries[0] && setSelected(entries[0])}
          >
            打开最近日志
            <ArrowUpRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <JournalEntrySheet
        entry={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
