import type { Trip } from "@roamlog/contracts";
import { AvatarGroup, Badge } from "@roamlog/ui";
import { ArrowUpRight, Heart, MapPin } from "lucide-react";
import Link from "next/link";

import {
  coverClassForTrip,
  formatBudget,
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
  tripDurationDays,
} from "@/lib/trip-presentation";

interface TripCardProps {
  trip: Trip;
  workspaceSlug: string;
  index: number;
  ownerName: string;
}

export function TripCard({ trip, workspaceSlug, index, ownerName }: TripCardProps) {
  const participants = [
    { id: "owner", name: ownerName, online: trip.status === "active" },
    ...trip.guestNames.map((name, participantIndex) => ({
      id: `guest-${index}-${participantIndex}`,
      name,
      online: trip.status === "active" && participantIndex === 0,
    })),
  ];

  return (
    <Link
      href={`/w/${workspaceSlug}/trips/${trip.id}`}
      className="group block overflow-hidden rounded-card border border-hairline-strong bg-surface-1 outline-none transition-colors hover:border-white/20 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <div
        className={`trip-cover ${coverClassForTrip(index)} aspect-[16/8] border-b border-hairline`}
      >
        <div className="flex h-full flex-col justify-between p-4">
          <div className="flex items-start justify-between gap-2">
            <Badge tone={getTripStatusTone(trip.status)}>{getTripStatusLabel(trip.status)}</Badge>
            {trip.favorite ? (
              <span
                aria-label="已收藏"
                className="flex size-8 items-center justify-center rounded-pill border border-hairline-strong bg-black/30 text-accent-orange backdrop-blur-sm"
              >
                <Heart aria-hidden="true" className="size-3.5 fill-current" />
              </span>
            ) : null}
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[0.13em] text-white/60">
            {trip.origin} → {trip.destinations.join(" · ")}
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-2xl leading-tight tracking-[-0.025em] text-ink transition-colors group-hover:text-white">
              {trip.title}
            </h2>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{trip.summary}</p>
          </div>
          <ArrowUpRight
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-stone transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-hairline pt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
          <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
          <span className="text-right">{tripDurationDays(trip.startDate, trip.endDate)} 天</span>
          <span className="flex items-center gap-1">
            <MapPin aria-hidden="true" className="size-3" />
            {trip.destinations.length} 站
          </span>
          <span className="text-right">
            {formatBudget(trip.budgetAmountMinor, trip.budgetCurrency)}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <AvatarGroup members={participants} max={3} size={24} />
          <span className="truncate text-[10px] text-stone">
            {trip.tags.slice(0, 2).join(" / ")}
          </span>
        </div>
      </div>
    </Link>
  );
}
