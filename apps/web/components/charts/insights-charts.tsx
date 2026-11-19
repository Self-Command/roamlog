"use client";

import { useId, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  cn,
  type ChartConfig,
} from "./chart-container";
import "./charts-motion.css";
import {
  categoryChartColors,
  categoryLabels,
  formatMoney,
  type BudgetRow,
  type MonthlySpendPoint,
} from "./insights-model";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Insights charts, built on the ported shadcn/ui chart primitives
 * (`chart-container.tsx`) plus Recharts 3.
 *
 * Motion contract (fixed by research):
 * - entrance: 220ms opacity + 6px translate, ease-out, played exactly once
 *   (`ChartReveal` adds the animation class on mount only)
 * - data update: 240ms (`animationDuration`, inside the 200-300ms band)
 * - `isAnimationActive="auto"` is Recharts' own reduced-motion mode; the
 *   component-level hook turns it hard off, and `charts-motion.css` removes
 *   the entrance animation for `prefers-reduced-motion: reduce`
 * - no infinite loop, pulse, breathing or hover scaling anywhere
 * - `accessibilityLayer` is left at the Recharts 3 default (`true`)
 */

const UPDATE_ANIMATION_MS = 240;
/** Keeps a single-trip stack from turning into a full-height slab. */
const MAX_BAR_SIZE = 28;

function animationProps(reducedMotion: boolean) {
  return {
    isAnimationActive: (reducedMotion ? false : "auto") as boolean | "auto",
    animationDuration: reducedMotion ? 0 : UPDATE_ANIMATION_MS,
    animationEasing: "ease-out" as const,
  };
}

/** One-shot entrance wrapper: 220ms, opacity + 6px, disabled on reduced motion. */
export function ChartReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <div
      className={cn(
        "roamlog-chart-enter",
        !reducedMotion && "roamlog-chart-enter--run",
        className,
      )}
    >
      {children}
    </div>
  );
}

const annualConfig = {
  trips: { label: "旅行次数", color: "var(--accent-orange)" },
} satisfies ChartConfig;

export function AnnualTripsChart({ data }: { data: Array<[string, number]> }) {
  const reducedMotion = useReducedMotion();
  const points = data.map(([year, count]) => ({ year, trips: count }));
  const ariaLabel = `年度旅行次数柱状图：${points
    .map((point) => `${point.year} 年 ${point.trips} 次`)
    .join("，")}`;

  return (
    <ChartContainer
      config={annualConfig}
      className="mt-4 h-44"
      initialDimension={{ width: 320, height: 176 }}
      role="group"
      aria-label={ariaLabel}
    >
      <BarChart
        accessibilityLayer
        data={points}
        barCategoryGap="32%"
        margin={{ top: 16, right: 4, left: 4 }}
      >
        <CartesianGrid vertical={false} stroke="var(--hairline)" />
        <XAxis dataKey="year" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis hide allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="dashed" />}
        />
        <Bar
          dataKey="trips"
          fill="var(--color-trips)"
          radius={[3, 3, 0, 0]}
          maxBarSize={56}
          {...animationProps(reducedMotion)}
        >
          <LabelList
            dataKey="trips"
            position="top"
            className="fill-body font-mono text-[9px]"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function MonthlySpendChart({
  points,
  currency,
}: {
  points: MonthlySpendPoint[];
  currency: string;
}) {
  const reducedMotion = useReducedMotion();
  const gradientId = `roamlog-spend-area-${useId().replace(/:/g, "")}`;
  const data = points.map((point) => ({
    month: point.label,
    amount: point.amountMinor / 100,
  }));
  const config = {
    amount: { label: `支出 · ${currency}`, color: "var(--accent-orange)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer
      config={config}
      className="mt-4 h-44"
      initialDimension={{ width: 600, height: 176 }}
      role="group"
      aria-label="最近十二个月支出面积图"
    >
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-orange)" stopOpacity={0.34} />
            <stop offset="100%" stopColor="var(--accent-orange)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--hairline)" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={1}
        />
        <YAxis hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) => formatMoney(Number(value) * 100, currency)}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="var(--color-amount)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          {...animationProps(reducedMotion)}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function CategoryMixChart({
  items,
  currency,
}: {
  items: Array<{ category: keyof typeof categoryLabels; total: number }>;
  currency: string;
}) {
  const reducedMotion = useReducedMotion();
  const data = items.map((item) => ({
    category: item.category,
    total: item.total,
    fill: categoryChartColors[item.category],
  }));
  const config = Object.fromEntries(
    items.map((item) => [
      item.category,
      {
        label: categoryLabels[item.category],
        color: categoryChartColors[item.category],
      },
    ]),
  ) as ChartConfig;

  return (
    <ChartContainer
      config={config}
      className="mt-4 h-40 w-full"
      initialDimension={{ width: 320, height: 160 }}
      role="group"
      aria-label="分类支出占比环形图"
    >
      <PieChart accessibilityLayer>
        <ChartTooltip
          content={
            <ChartTooltipContent
              nameKey="category"
              formatter={(value) => formatMoney(Number(value), currency)}
            />
          }
        />
        <Pie
          data={data}
          dataKey="total"
          nameKey="category"
          innerRadius="58%"
          outerRadius="92%"
          paddingAngle={2}
          stroke="none"
          {...animationProps(reducedMotion)}
        >
          {data.map((entry) => (
            <Cell key={entry.category} fill={entry.fill} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

type BudgetBarDatum = {
  trip: string;
  currency: string;
  spentMoney: number;
  overMoney: number;
  remainingMoney: number;
  spent: number;
  over: number;
  remaining: number;
};

const budgetConfig = {
  spent: { label: "已用", color: "var(--accent-orange)" },
  over: { label: "超支", color: "var(--accent-red)" },
  remaining: { label: "剩余", color: "var(--hairline-strong)" },
} satisfies ChartConfig;

/**
 * Stacked bar per trip: `已用 + 超支 + 剩余`. The axis is normalised to the
 * percentage of each trip's own budget so bars stay comparable when the top
 * budgets use different currencies; the tooltip prints the trip's own money.
 */
export function BudgetCompositionChart({ rows }: { rows: BudgetRow[] }) {
  const reducedMotion = useReducedMotion();
  const data: BudgetBarDatum[] = rows.map((row) => {
    const budget = Math.max(1, row.budgetAmountMinor);
    const overMoney = Math.max(0, row.spentAmountMinor - row.budgetAmountMinor);
    return {
      trip: row.trip.title,
      currency: row.currency,
      spentMoney: Math.min(row.spentAmountMinor, row.budgetAmountMinor),
      overMoney,
      remainingMoney: Math.max(0, row.budgetAmountMinor - row.spentAmountMinor),
      spent: (Math.min(row.spentAmountMinor, row.budgetAmountMinor) / budget) * 100,
      over: (overMoney / budget) * 100,
      remaining: (Math.max(0, row.budgetAmountMinor - row.spentAmountMinor) / budget) * 100,
    };
  });

  return (
    <ChartContainer
      config={budgetConfig}
      className="mt-4 h-44"
      initialDimension={{ width: 480, height: 176 }}
      role="group"
      aria-label="预算构成堆叠条形图"
    >
      <BarChart
        accessibilityLayer
        data={data}
        layout="vertical"
        barCategoryGap="28%"
        margin={{ left: 0, right: 8, top: 4, bottom: 4 }}
      >
        <XAxis
          type="number"
          hide
          domain={[0, (dataMax: number) => Math.max(100, Math.ceil(dataMax))]}
        />
        <YAxis type="category" dataKey="trip" hide />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dashed"
              formatter={(value, name, item) => {
                const datum = (item as { payload?: BudgetBarDatum } | undefined)?.payload;
                const percent = Number(value);
                if (!datum) return `${percent.toFixed(1)}%`;
                const money =
                  name === "over"
                    ? datum.overMoney
                    : name === "spent"
                      ? datum.spentMoney
                      : datum.remainingMoney;
                return `${percent.toFixed(1)}% · ${formatMoney(money, datum.currency)}`;
              }}
            />
          }
        />
        <Bar
          dataKey="spent"
          stackId="budget"
          fill="var(--color-spent)"
          maxBarSize={MAX_BAR_SIZE}
          {...animationProps(reducedMotion)}
        />
        <Bar
          dataKey="over"
          stackId="budget"
          fill="var(--color-over)"
          maxBarSize={MAX_BAR_SIZE}
          {...animationProps(reducedMotion)}
        />
        <Bar
          dataKey="remaining"
          stackId="budget"
          fill="var(--color-remaining)"
          maxBarSize={MAX_BAR_SIZE}
          {...animationProps(reducedMotion)}
        />
      </BarChart>
    </ChartContainer>
  );
}
