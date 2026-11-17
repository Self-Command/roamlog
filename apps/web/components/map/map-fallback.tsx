"use client";

import { MapPin } from "lucide-react";

import { shortDate } from "@/lib/demo-format";

import type { MapPoint, MapStop } from "./map-types";

interface MapFallbackProps {
  stops: MapStop[];
  points: MapPoint[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  reason?: "unavailable" | "manual";
}

export function MapFallback({
  stops,
  points,
  selectedId,
  onSelect,
  reason = "unavailable",
}: MapFallbackProps) {
  return (
    <div className="grid min-h-72 lg:grid-cols-[minmax(0,1fr)_300px] lg:divide-x lg:divide-hairline">
      <div className="relative min-h-64 overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgba(59,158,255,0.08),transparent_58%)]">
        <SchematicRouteMap
          points={points}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <div className="absolute left-3 top-3 rounded-pill border border-hairline-strong bg-black/65 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-white/65">
          {reason === "manual" ? "LIST VIEW" : "TILE FALLBACK"} / ACCESSIBLE MAP
        </div>
      </div>

      <aside className="max-h-[28rem] overflow-y-auto p-3" aria-label="停靠点列表">
        <div className="sticky top-0 z-10 bg-surface-1 pb-2 pt-1">
          <p className="type-eyebrow">STOP LIST / {stops.length}</p>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            地图瓦片不可用时，路线、日期和停靠点仍可完整阅读。
          </p>
        </div>
        <div className="space-y-2">
          {stops.map((stop, index) => {
            const selected = stop.id === selectedId;
            return (
              <button
                key={stop.id}
                type="button"
                aria-pressed={selected}
                aria-label={`选择停靠点 ${stop.city}`}
                onClick={() => onSelect?.(stop.id)}
                className={`w-full rounded-control border p-3 text-left transition-colors ${
                  selected
                    ? "border-accent-orange/55 bg-surface-2"
                    : "border-hairline bg-surface-1 hover:bg-surface-2"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-pill border font-mono text-[9px] ${
                      selected
                        ? "border-accent-orange text-accent-orange"
                        : "border-hairline-strong text-muted"
                    }`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">
                      {stop.city} · {stop.country}
                    </span>
                    <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                      {shortDate(stop.startDate)} — {shortDate(stop.endDate)}
                    </span>
                    {stop.notes ? (
                      <span className="mt-1.5 line-clamp-2 block text-[10px] leading-5 text-muted">
                        {stop.notes}
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            );
          })}
          {!stops.length ? (
            <div className="rounded-control border border-dashed border-hairline-strong px-3 py-8 text-center">
              <MapPin aria-hidden="true" className="mx-auto size-4 text-stone" />
              <p className="mt-2 text-xs text-muted">还没有可显示的停靠点。</p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export function SchematicRouteMap({
  points,
  selectedId,
  onSelect,
}: {
  points: MapPoint[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const projected = points.map((point) => ({
    ...point,
    x: ((point.lng + 180) / 360) * 1000,
    y: ((90 - point.lat) / 180) * 520,
  }));

  return (
    <svg
      viewBox="0 0 1000 520"
      role="img"
      aria-label={`简化世界地图，显示 ${points.length} 个停靠点`}
      data-testid="world-map"
      className="h-full min-h-64 w-full"
    >
      <defs>
        <linearGradient id="fallback-ocean" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b1017" />
          <stop offset="1" stopColor="#050608" />
        </linearGradient>
        <pattern id="fallback-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="1000" height="520" fill="url(#fallback-ocean)" />
      <rect width="1000" height="520" fill="url(#fallback-grid)" />
      <g
        aria-hidden="true"
        fill="#12161a"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      >
        <path d="M90 120 150 80 225 92 278 128 272 176 224 190 198 235 154 242 122 213 96 172Z" />
        <path d="M250 238 295 250 315 292 304 340 274 382 251 360 236 310 221 270Z" />
        <path d="M445 155 497 144 535 166 538 205 510 230 471 238 446 218 432 188Z" />
        <path d="M487 246 535 235 566 260 555 318 531 372 502 374 484 330 490 287Z" />
        <path d="M551 92 630 70 722 84 780 108 827 106 882 134 914 170 886 199 840 195 814 172 774 177 738 155 690 166 642 143 589 140 557 122Z" />
        <path d="M792 218 824 207 852 223 845 252 823 270 795 258Z" />
        <path d="M850 275 897 267 925 288 914 318 879 322 852 303Z" />
        <path d="M658 318 716 306 752 332 738 365 694 376 664 350Z" />
      </g>

      {projected.length > 1 ? (
        <polyline
          points={projected.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="rgba(255,128,31,0.5)"
          strokeWidth="1.4"
          strokeDasharray="5 5"
        />
      ) : null}

      {projected.map((point) => {
        const selected = point.id === selectedId;
        return (
          <g
            key={point.id}
            role={onSelect ? "button" : "img"}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={point.label}
            aria-pressed={selected}
            className={onSelect ? "cursor-pointer outline-none focus-visible:opacity-75" : ""}
            onClick={() => onSelect?.(point.id)}
            onKeyDown={(event) => {
              if (!onSelect) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(point.id);
              }
            }}
          >
            <circle cx={point.x} cy={point.y} r={selected ? 18 : 12} fill="rgba(255,128,31,0.14)" />
            <circle
              cx={point.x}
              cy={point.y}
              r={selected ? 6 : 4}
              fill={selected ? "#ff801f" : "rgba(252,253,255,0.78)"}
              stroke={selected ? "#fff" : "rgba(0,0,0,0.78)"}
              strokeWidth="1.5"
            />
            <text
              x={point.x + 9}
              y={point.y + 3}
              fill={selected ? "#fcfdff" : "rgba(252,253,255,0.55)"}
              fontSize="9"
              fontFamily="monospace"
            >
              {point.label.slice(0, 12)}
            </text>
          </g>
        );
      })}

      <text x="20" y="500" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace">
        SCHEMATIC WORLD / FIXTURE COORDINATES
      </text>
    </svg>
  );
}
