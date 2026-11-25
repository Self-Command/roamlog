"use client";

import type { Trip } from "@roamlog/contracts";
import { AvatarGroup, Badge } from "@roamlog/ui";
import { ArrowUpRight, Heart, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  formatBudget,
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
} from "@/lib/trip-presentation";

interface TripCardProps {
  trip: Trip;
  workspaceSlug: string;
  index: number;
  ownerName: string;
}

export function TripCard({ trip, workspaceSlug, ownerName }: TripCardProps) {
  const coverUrl = trip.cover?.url ?? trip.cover?.thumbUrl ?? null;
  const [coverFailed, setCoverFailed] = useState(false);
  const hasBudget = trip.budgetAmountMinor !== null && trip.budgetCurrency !== null;
  const participants = [
    { id: "owner", name: ownerName },
    ...trip.guestNames.map((name, participantIndex) => ({
      id: `guest-${trip.id}-${participantIndex}`,
      name,
    })),
  ];

  useEffect(() => {
    setCoverFailed(false);
  }, [coverUrl]);

  return (
    <Link
      href={`/w/${workspaceSlug}/trips/${trip.id}`}
      className="surface-card group block overflow-hidden outline-none transition-[border-color,box-shadow] hover:border-ink/20 hover:shadow-overlay focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <div className="relative aspect-[16/8] overflow-hidden border-b border-hairline bg-surface-2">
        {coverUrl && !coverFailed ? (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-4">
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
          <p className="text-[11px] font-medium text-white/75">
            {trip.origin}
            {trip.destinations.length > 0 ? ` → ${trip.destinations.join(" · ")}` : ""}
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-tight font-semibold tracking-[-0.015em] text-ink">
              {trip.title}
            </h2>
            {trip.summary ? (
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{trip.summary}</p>
            ) : null}
          </div>
          <ArrowUpRight
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-stone transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-hairline pt-3 text-[11px] text-muted">
          <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
          <span className="text-right">{trip.durationDays} 天</span>
          <span className="flex items-center gap-1">
            <MapPin aria-hidden="true" className="size-3" />
            {trip.destinations.length} 站
          </span>
          {hasBudget ? (
            <span className="text-right">
              {formatBudget(trip.budgetAmountMinor, trip.budgetCurrency)}
            </span>
          ) : (
            <span />
          )}
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
