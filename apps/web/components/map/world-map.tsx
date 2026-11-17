"use client";

import type { Trip } from "@roamlog/contracts";

const COUNTRY_POINTS: Record<string, [number, number]> = {
  KR: [815, 235],
  JP: [842, 223],
  IS: [466, 124],
  PT: [449, 205],
  IT: [520, 191],
  CL: [266, 378],
  AR: [282, 392],
  GR: [535, 214],
  MA: [456, 239],
};

const HOME_POINT: [number, number] = [803, 249];

function pointForTrip(trip: Trip, index: number): [number, number] {
  const code = trip.countryCodes[0] ?? "";
  const base = COUNTRY_POINTS[code] ?? [500, 250];
  return [base[0] + (index % 3) * 7, base[1] - (index % 2) * 7];
}

interface WorldMapProps {
  trips: Trip[];
  selectedTripId?: string;
  onSelect?: (tripId: string) => void;
  className?: string;
}

export function WorldMap({ trips, selectedTripId, onSelect, className }: WorldMapProps) {
  return (
    <svg
      viewBox="0 0 1000 520"
      role="img"
      aria-label={`世界旅行足迹地图，显示 ${trips.length} 趟旅行`}
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

      {trips.map((trip, index) => {
        const [x, y] = pointForTrip(trip, index);
        const selected = trip.id === selectedTripId;
        return (
          <g key={trip.id}>
            <path
              d={`M${HOME_POINT[0]} ${HOME_POINT[1]} Q ${(HOME_POINT[0] + x) / 2} ${
                Math.min(HOME_POINT[1], y) - 34
              } ${x} ${y}`}
              fill="none"
              stroke={selected ? "rgba(255,128,31,0.75)" : "rgba(255,255,255,0.12)"}
              strokeDasharray={trip.status === "completed" ? undefined : "4 5"}
              strokeWidth={selected ? 1.7 : 0.9}
            />
            <circle cx={x} cy={y} r="19" fill="url(#marker-glow)" />
            <g
              role={onSelect ? "button" : "img"}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={`${trip.title}，${trip.status}`}
              className={onSelect ? "cursor-pointer outline-none focus-visible:opacity-80" : ""}
              onClick={() => onSelect?.(trip.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect?.(trip.id);
                }
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={selected ? 6.5 : 4.5}
                fill={selected ? "#ff801f" : "rgba(252,253,255,0.74)"}
                stroke={selected ? "#fff" : "rgba(0,0,0,0.8)"}
                strokeWidth="1.5"
              />
              {selected ? (
                <text
                  x={x + 11}
                  y={y + 3}
                  fill="#fcfdff"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {trip.title.slice(0, 10)}
                </text>
              ) : null}
            </g>
          </g>
        );
      })}

      <g transform="translate(20 484)">
        <circle cx="4" cy="4" r="3" fill="#ff801f" />
        <text x="14" y="8" fill="rgba(255,255,255,0.55)" fontSize="9" fontFamily="monospace">
          HOME · SHANGHAI
        </text>
        <text x="820" y="8" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace">
          SCHEMATIC WORLD / FIXTURE COORDINATES
        </text>
      </g>
    </svg>
  );
}
