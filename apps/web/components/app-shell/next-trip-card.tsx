"use client";

import type { Trip } from "@roamlog/contracts";
import { Badge, type ShellLinkComponent } from "@roamlog/ui";

import { formatDateRange, getTripStatusLabel } from "@/lib/trip-presentation";

const DefaultLink = "a" as ShellLinkComponent;

interface NextTripCardProps {
  trip: Trip;
  workspaceSlug: string;
  linkComponent?: ShellLinkComponent;
}

export function NextTripCard({
  trip,
  workspaceSlug,
  linkComponent: Link = DefaultLink,
}: NextTripCardProps) {
  return (
    <Link
      href={`/w/${workspaceSlug}/trips/${trip.id}`}
      className="block rounded-card border border-hairline bg-surface-1 p-3 outline-none transition-colors hover:border-hairline-strong focus-visible:ring-2 focus-visible:ring-ink"
    >
      <span className="flex items-center justify-between gap-2">
        <Badge tone={trip.status === "active" ? "green" : "orange"}>
          {getTripStatusLabel(trip.status)}
        </Badge>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
          {trip.countryCodes.join(" · ")}
        </span>
      </span>
      <span className="mt-2 block font-display text-base leading-tight font-semibold tracking-[-0.01em] text-ink">
        {trip.title}
      </span>
      <span className="mt-2 block text-[11px] text-muted">
        {formatDateRange(trip.startDate, trip.endDate)}
      </span>
      <span className="mt-1.5 block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-ash">
        {trip.origin} → {trip.destinations.join(" → ")}
      </span>
    </Link>
  );
}
