"use client";

import type { MapPoint } from "./map-types";

interface WorldMapProps {
  points: MapPoint[];
  selectedId?: string;
  onSelect?: (pointId: string) => void;
  className?: string;
  label?: string;
}

export function WorldMap({
  points,
  selectedId,
  onSelect,
  className,
  label = "真实停靠点地图",
}: WorldMapProps) {
  return (
    <svg
      viewBox="0 0 1000 520"
      role="img"
      aria-label={`${label}，显示 ${points.length} 个停靠点`}
      data-testid="world-map"
      className={className ?? "h-auto w-full"}
    >
      <defs>
        <linearGradient id="ocean-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0c1118" />
          <stop offset="1" stopColor="#050608" />
        </linearGradient>
        <radialGradient id="marker-glow">
          <stop offset="0" stopColor="#ff801f" stopOpacity="0.34" />
          <stop offset="1" stopColor="#ff801f" stopOpacity="0" />
        </radialGradient>
        <pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M50 0H0V50" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="1000" height="520" fill="url(#ocean-wash)" />
      <rect width="1000" height="520" fill="url(#map-grid)" />

      <g
        aria-hidden="true"
        fill="#12161a"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      >
        <path d="M90 120 150 80 225 92 278 128 272 176 224 190 198 235 154 242 122 213 96 172Z" />
        <path d="M250 238 295 250 315 292 304 340 274 382 251 360 236 310 221 270Z" />
        <path d="M425 112 472 94 503 111 496 138 466 145 443 136Z" />
        <path d="M445 155 497 144 535 166 538 205 510 230 471 238 446 218 432 188Z" />
        <path d="M487 246 535 235 566 260 555 318 531 372 502 374 484 330 490 287Z" />
        <path d="M551 92 630 70 722 84 780 108 827 106 882 134 914 170 886 199 840 195 814 172 774 177 738 155 690 166 642 143 589 140 557 122Z" />
        <path d="M792 218 824 207 852 223 845 252 823 270 795 258Z" />
        <path d="M850 275 897 267 925 288 914 318 879 322 852 303Z" />
        <path d="M658 318 716 306 752 332 738 365 694 376 664 350Z" />
      </g>

      {points.map((point) => {
        const x = ((point.lng + 180) / 360) * 1000;
        const y = ((90 - point.lat) / 180) * 520;
        const selected = point.id === selectedId;
        return (
          <g
            key={point.id}
            role={onSelect ? "button" : "img"}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={point.label}
            aria-pressed={selected}
            className={onSelect ? "cursor-pointer outline-none focus-visible:opacity-80" : ""}
            onClick={() => onSelect?.(point.id)}
            onKeyDown={(event) => {
              if (!onSelect) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(point.id);
              }
            }}
          >
            <circle cx={x} cy={y} r="19" fill="url(#marker-glow)" />
            <circle
              cx={x}
              cy={y}
              r={selected ? 6.5 : 4.5}
              fill={selected ? "#ff801f" : "rgba(252,253,255,0.74)"}
              stroke={selected ? "#fff" : "rgba(0,0,0,0.8)"}
              strokeWidth="1.5"
            />
            {selected ? (
              <text x={x + 11} y={y + 3} fill="#fcfdff" fontSize="10" fontFamily="monospace">
                {point.label.slice(0, 10)}
              </text>
            ) : null}
          </g>
        );
      })}

      <g transform="translate(20 484)">
        <text x="0" y="8" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace">
          SCHEMATIC WORLD / REAL STOP COORDINATES
        </text>
      </g>
    </svg>
  );
}