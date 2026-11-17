"use client";

import { Badge, Button } from "@roamlog/ui";
import { List, Map as MapIcon, MapPin } from "lucide-react";
import { useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";
import { WorldMap } from "@/components/map/world-map";

export function TripMapTab({ tripId }: { tripId: string }) {
  const { state } = useDemoStore();
  const trip = state.trips.find((candidate) => candidate.id === tripId);
  const stops = state.stops
    .filter((stop) => stop.tripId === tripId)
    .sort((left, right) => left.order - right.order);
  const [mode, setMode] = useState<"map" | "list">("map");

  if (!trip) return null;

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-hairline p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-eyebrow">ROUTE / {stops.length} STOPS</p>
          <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">路线与停靠点</h2>
          <p className="mt-2 text-xs text-muted">
            MapLibre 瓦片尚未接入。当前使用可键盘聚焦的示意地图，随时可切换到列表。
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-control border border-hairline-strong bg-surface-2 p-1">
          <Button
            type="button"
            variant={mode === "map" ? "subtle" : "ghost"}
            size="sm"
            className="border-0"
            aria-pressed={mode === "map"}
            onClick={() => setMode("map")}
          >
            <MapIcon aria-hidden="true" />
            地图
          </Button>
          <Button
            type="button"
            variant={mode === "list" ? "subtle" : "ghost"}
            size="sm"
            className="border-0"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            <List aria-hidden="true" />
            列表
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px] lg:divide-x lg:divide-hairline">
        <div className="relative min-h-64 overflow-hidden border-b border-hairline lg:border-b-0">
          {mode === "map" ? (
            <WorldMap trips={[trip]} className="h-full min-h-72 w-full object-cover" />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(59,158,255,0.08),transparent_55%)] px-6 text-center">
              <MapPin aria-hidden="true" className="size-5 text-accent-orange" />
              <p className="mt-3 font-serif text-2xl text-ink">列表视图已启用</p>
              <p className="mt-2 text-xs text-muted">所有停靠点都可在右侧阅读，地图不是唯一入口。</p>
            </div>
          )}
          <Badge tone="neutral" className="absolute left-3 top-3 bg-black/60">
            SCHEMATIC / NOT LIVE TILES
          </Badge>
        </div>

        <aside className="max-h-[28rem] overflow-y-auto p-3">
          <div className="sticky top-0 z-10 bg-surface-1 pb-2 pt-1">
            <p className="type-eyebrow">STOP LIST</p>
          </div>
          <div className="space-y-2">
            {stops.map((stop, index) => (
              <div
                key={stop.id}
                className="rounded-control border border-hairline bg-surface-2 p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-pill border border-hairline-strong font-mono text-[9px] text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {stop.city} · {stop.country}
                    </p>
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                      {shortDate(stop.startDate)} — {shortDate(stop.endDate)}
                    </p>
                    <p className="mt-1.5 text-[10px] leading-5 text-muted">{stop.notes}</p>
                    {stop.lat !== null && stop.lng !== null ? (
                      <p className="mt-1 font-mono text-[8px] text-stone">
                        {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
