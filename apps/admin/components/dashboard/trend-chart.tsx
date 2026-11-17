import type { AdminTrendPoint } from "../../lib/fixtures";
import type { AdminDataMode } from "../../lib/admin-data-mode";

interface TrendChartProps {
  data: AdminTrendPoint[];
  mode?: AdminDataMode;
}

const WIDTH = 760;
const HEIGHT = 250;
const PADDING = { top: 22, right: 18, bottom: 32, left: 18 };

function normalizePoints(values: number[]): Array<{ x: number; y: number }> {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const xStep = values.length > 1 ? plotWidth / (values.length - 1) : 0;

  return values.map((value, index) => ({
    x: PADDING.left + index * xStep,
    y: PADDING.top + (1 - (value - minimum) / range) * plotHeight,
  }));
}

function linePath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function areaPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }
  const baseline = HEIGHT - PADDING.bottom;
  return `${linePath(points)} L ${points.at(-1)?.x ?? 0} ${baseline} L ${points[0]?.x ?? 0} ${baseline} Z`;
}

export function TrendChart({ data, mode = "fixture" }: TrendChartProps) {
  const users = normalizePoints(data.map((point) => point.users));
  const workspaces = normalizePoints(data.map((point) => point.workspaces));
  const labelIndexes = new Set([
    0,
    Math.floor(data.length / 3),
    Math.floor((2 * data.length) / 3),
    data.length - 1,
  ]);

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          <span aria-hidden="true" className="size-1.5 rounded-pill bg-accent-blue" />
          用户
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          <span aria-hidden="true" className="size-1.5 rounded-pill bg-accent-orange" />
          工作区
        </span>
        <span className="ml-auto font-mono text-[9px] uppercase text-stone">
          {data.length} {data.length === 1 ? "SNAPSHOT" : "DAYS"} / {mode}
        </span>
      </div>
      <div className="overflow-hidden rounded-control border border-hairline bg-black/30">
        <svg
          role="img"
          aria-label={`用户与工作区 ${data.length} 日趋势图`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[560px]"
        >
          <title>用户与工作区 12 日趋势图</title>
          <defs>
            <linearGradient id="admin-users-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3].map((row) => {
            const y = PADDING.top + ((HEIGHT - PADDING.top - PADDING.bottom) / 3) * row;
            return (
              <line
                key={row}
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                stroke="var(--hairline)"
                strokeWidth="1"
              />
            );
          })}

          <path d={areaPath(users)} fill="url(#admin-users-area)" />
          <path
            d={linePath(users)}
            fill="none"
            stroke="var(--accent-blue)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={linePath(workspaces)}
            fill="none"
            stroke="var(--accent-orange)"
            strokeWidth="1.25"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />

          {users.map((point, index) =>
            index === users.length - 1 ? (
              <circle
                key="latest-user"
                cx={point.x}
                cy={point.y}
                r="3"
                fill="var(--accent-blue)"
                stroke="var(--canvas)"
                strokeWidth="2"
              />
            ) : null,
          )}

          {data.map((point, index) =>
            labelIndexes.has(index) ? (
              <text
                key={point.period}
                x={users[index]?.x}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
                fill="var(--stone)"
                fontFamily="var(--roamlog-font-mono)"
                fontSize="8"
              >
                {point.period}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <ul className="sr-only">
        {data.map((point) => (
          <li key={point.period}>
            {point.period}: {point.users} 位用户，{point.workspaces} 个工作区
          </li>
        ))}
      </ul>
    </div>
  );
}
