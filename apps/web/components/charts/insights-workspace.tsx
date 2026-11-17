"use client";

import type { ExpenseCategory } from "@roamlog/contracts";
import { Badge, Button, PageHeader } from "@roamlog/ui";
import {
  CalendarRange,
  Download,
  Globe2,
  MapPin,
  Plane,
  Route,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { formatMinor, shortDate } from "@/lib/demo-format";
import { tripDurationDays } from "@/lib/trip-presentation";

const categoryLabels: Record<ExpenseCategory, string> = {
  transport: "交通",
  stay: "住宿",
  food: "餐饮",
  activity: "活动",
  shopping: "购物",
  other: "其他",
};

const categoryColors: Record<ExpenseCategory, string> = {
  transport: "bg-accent-blue",
  stay: "bg-accent-orange",
  food: "bg-accent-yellow",
  activity: "bg-accent-green",
  shopping: "bg-accent-red",
  other: "bg-accent-slate",
};

export function InsightsWorkspace() {
  const { state } = useDemoStore();
  const [notice, setNotice] = useState<string | null>(null);
  const totalDays = state.trips.reduce(
    (sum, trip) => sum + tripDurationDays(trip.startDate, trip.endDate),
    0,
  );
  const countries = new Set(state.trips.flatMap((trip) => trip.countryCodes));
  const cities = new Set(state.trips.flatMap((trip) => trip.destinations));
  const totalSpent = state.expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

  const annual = useMemo(() => {
    const map = new Map<string, number>();
    state.trips.forEach((trip) => {
      const year = trip.startDate.slice(0, 4);
      map.set(year, (map.get(year) ?? 0) + 1);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state.trips]);
  const annualMax = Math.max(1, ...annual.map(([, count]) => count));

  const monthly = useMemo(() => {
    const points: Array<{ key: string; label: string; amountMinor: number }> = [];
    const latest = "2026-11";
    const [yearText, monthText] = latest.split("-");
    const base = new Date(Number(yearText), Number(monthText) - 1, 1);
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(base.getFullYear(), base.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      points.push({
        key,
        label: `${String(date.getMonth() + 1).padStart(2, "0")}月`,
        amountMinor: state.expenses
          .filter((expense) => expense.date.startsWith(key))
          .reduce((sum, expense) => sum + expense.amountMinor, 0),
      });
    }
    return points;
  }, [state.expenses]);
  const monthlyMax = Math.max(1, ...monthly.map((point) => point.amountMinor));
  const linePoints = monthly
    .map((point, index) => {
      const x = 10 + (index / Math.max(1, monthly.length - 1)) * 580;
      const y = 150 - (point.amountMinor / monthlyMax) * 120;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPoints = `10,160 ${linePoints} 590,160`;

  const categories = useMemo(
    () =>
      (Object.keys(categoryLabels) as ExpenseCategory[])
        .map((category) => ({
          category,
          total: state.expenses
            .filter((expense) => expense.category === category)
            .reduce((sum, expense) => sum + expense.amountMinor, 0),
        }))
        .filter((item) => item.total > 0)
        .sort((left, right) => right.total - left.total),
    [state.expenses],
  );
  const categoryTotal = categories.reduce((sum, item) => sum + item.total, 0);
  const budgetRows = state.trips
    .map((trip) => ({
      trip,
      spent: state.expenses
        .filter((expense) => expense.tripId === trip.id)
        .reduce((sum, expense) => sum + expense.amountMinor, 0),
    }))
    .filter((row) => row.trip.budgetAmountMinor)
    .sort((left, right) => (right.trip.budgetAmountMinor ?? 0) - (left.trip.budgetAmountMinor ?? 0))
    .slice(0, 6);

  const heatmap = useMemo(() => {
    const years = [...new Set(state.entries.map((entry) => entry.date.slice(0, 4)))].sort();
    return years.map((year) => ({
      year,
      months: Array.from({ length: 12 }, (_, index) => {
        const key = `${year}-${String(index + 1).padStart(2, "0")}`;
        return {
          key,
          count:
            state.entries.filter((entry) => entry.date.startsWith(key)).length +
            state.expenses.filter((expense) => expense.date.startsWith(key)).length,
        };
      }),
    }));
  }, [state.entries, state.expenses]);

  function exportCsv() {
    const tripById = new Map(state.trips.map((trip) => [trip.id, trip.title]));
    const rows = state.expenses.map((expense) =>
      [
        expense.date,
        tripById.get(expense.tripId) ?? expense.tripId,
        categoryLabels[expense.category],
        expense.note,
        expense.amountMinor / 100,
        expense.currency,
      ]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob(
      [`日期,旅行,分类,备注,金额,币种\n${rows.join("\n")}`],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "roamlog-expenses.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("已导出当前本地 fixture 的 20 笔支出。");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="INSIGHTS / 2024—2027"
        title="旅行洞察"
        description="年度旅行、月度支出、分类、预算对比和记录热力图，全部由当前本地旅行与花费数据计算。"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
            <Download aria-hidden="true" />
            导出支出
          </Button>
        }
      />
      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline xl:grid-cols-4">
        {[
          { label: "旅行次数", value: state.trips.length, hint: "含愿望与计划", icon: Plane },
          { label: "旅行天数", value: totalDays, hint: "按起止日期计算", icon: CalendarRange },
          { label: "国家 / 地区", value: countries.size, hint: `${cities.size} 座城市`, icon: Globe2 },
          {
            label: "总支出",
            value: formatMinor(totalSpent),
            hint: `${state.expenses.length} 笔明细`,
            icon: Wallet,
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-1 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="type-eyebrow">{stat.label}</p>
              <stat.icon aria-hidden="true" className="size-3.5 text-muted" />
            </div>
            <p className="mt-3 font-serif text-3xl tracking-[-0.03em] text-ink">{stat.value}</p>
            <p className="mt-1.5 text-[10px] text-muted">{stat.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="surface-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">ANNUAL TRIPS</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">年度旅行次数</h2>
            </div>
            <Badge tone="neutral">{state.trips.length}</Badge>
          </div>
          <div className="mt-6 flex h-44 items-end gap-3">
            {annual.map(([year, count]) => (
              <div
                key={year}
                tabIndex={0}
                role="img"
                aria-label={`${year} 年 ${count} 次旅行`}
                className="flex h-full flex-1 flex-col justify-end gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <div className="relative flex flex-1 items-end">
                  <div
                    className="w-full rounded-t-[3px] bg-gradient-to-t from-accent-orange/35 to-accent-orange/80"
                    style={{ height: `${Math.max(8, (count / annualMax) * 100)}%` }}
                  />
                  <span className="absolute -top-5 inset-x-0 text-center font-mono text-[9px] text-body">
                    {count}
                  </span>
                </div>
                <span className="text-center font-mono text-[8px] text-stone">{year}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="type-eyebrow">MONTHLY SPEND</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">月度支出节奏</h2>
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
              LAST 12 MONTHS · {formatMinor(monthly.reduce((sum, item) => sum + item.amountMinor, 0))}
            </p>
          </div>
          <div className="mt-4 overflow-hidden rounded-control border border-hairline bg-surface-2 p-2">
            <svg
              viewBox="0 0 600 170"
              role="img"
              aria-label="最近十二个月支出面积图"
              className="h-44 w-full"
            >
              <defs>
                <linearGradient id="spend-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ff801f" stopOpacity="0.34" />
                  <stop offset="1" stopColor="#ff801f" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 40, 80, 120, 160].map((y) => (
                <line
                  key={y}
                  x1="10"
                  y1={y}
                  x2="590"
                  y2={y}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="1"
                />
              ))}
              <polygon points={areaPoints} fill="url(#spend-area)" />
              <polyline
                points={linePoints}
                fill="none"
                stroke="#ff801f"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              {monthly.map((point, index) => {
                const x = 10 + (index / Math.max(1, monthly.length - 1)) * 580;
                const y = 150 - (point.amountMinor / monthlyMax) * 120;
                return (
                  <circle
                    key={point.key}
                    cx={x}
                    cy={y}
                    r="2.5"
                    fill="#070708"
                    stroke="#ff801f"
                    strokeWidth="1.5"
                  >
                    <title>{`${point.label} · ${formatMinor(point.amountMinor)}`}</title>
                  </circle>
                );
              })}
              {monthly.map((point, index) => (
                <text
                  key={`${point.key}-label`}
                  x={10 + (index / Math.max(1, monthly.length - 1)) * 580}
                  y="166"
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.35)"
                  fontSize="7"
                  fontFamily="monospace"
                >
                  {index % 2 === 0 ? point.label : ""}
                </text>
              ))}
            </svg>
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">CATEGORY MIX</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">分类支出</h2>
            </div>
            <Badge tone="neutral">{state.expenses.length} 笔</Badge>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-pill bg-white/5">
            {categories.map((item) => (
              <div
                key={item.category}
                className={categoryColors[item.category]}
                style={{ width: `${(item.total / Math.max(1, categoryTotal)) * 100}%` }}
                title={`${categoryLabels[item.category]} ${formatMinor(item.total)}`}
              />
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {categories.map((item) => (
              <div key={item.category}>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="inline-flex items-center gap-2 text-body">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-pill ${categoryColors[item.category]}`}
                    />
                    {categoryLabels[item.category]}
                  </span>
                  <span className="font-mono text-muted">
                    {formatMinor(item.total)} · {Math.round((item.total / Math.max(1, categoryTotal)) * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">BUDGET / SPENT</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">预算对比</h2>
            </div>
            <span className="font-mono text-[9px] uppercase text-stone">TOP 6 BUDGETS</span>
          </div>
          <div className="mt-4 space-y-4">
            {budgetRows.map(({ trip, spent }) => {
              const budget = trip.budgetAmountMinor ?? 1;
              const percent = Math.round((spent / Math.max(1, budget)) * 100);
              return (
                <div key={trip.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-body">{trip.title}</p>
                      <p className="mt-0.5 font-mono text-[8px] uppercase text-stone">
                        {trip.destinations[0]} · {percent}%
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-muted">
                      {formatMinor(spent)} / {formatMinor(budget)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-white/5">
                    <div
                      className={`h-full rounded-pill ${
                        spent > budget ? "bg-accent-red" : "bg-accent-orange"
                      }`}
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">ACTIVITY GRID</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">记录热力图</h2>
            </div>
            <div className="flex items-center gap-1 font-mono text-[8px] text-stone">
              少
              {[0, 1, 2, 3].map((level) => (
                <span
                  key={level}
                  className={`size-2 rounded-[2px] ${
                    level === 0
                      ? "bg-white/5"
                      : level === 1
                        ? "bg-accent-green/20"
                        : level === 2
                          ? "bg-accent-green/45"
                          : "bg-accent-green/80"
                  }`}
                />
              ))}
              多
            </div>
          </div>
          <div className="mt-4 space-y-2 overflow-x-auto">
            {heatmap.map((row) => (
              <div key={row.year} className="flex min-w-[520px] items-center gap-2">
                <span className="w-10 shrink-0 font-mono text-[8px] text-stone">{row.year}</span>
                <div className="grid flex-1 grid-cols-12 gap-1">
                  {row.months.map((cell) => (
                    <div
                      key={cell.key}
                      tabIndex={0}
                      role="img"
                      aria-label={`${cell.key} 记录 ${cell.count} 条`}
                      className={`h-7 rounded-[3px] outline-none focus-visible:ring-1 focus-visible:ring-ink ${
                        cell.count === 0
                          ? "bg-white/[0.045]"
                          : cell.count < 2
                            ? "bg-accent-green/20"
                            : cell.count < 5
                              ? "bg-accent-green/45"
                              : "bg-accent-green/80"
                      }`}
                      title={`${cell.key} · ${cell.count} 条记录`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card p-5 lg:col-span-4">
          <p className="type-eyebrow">TRAVEL RECORDS</p>
          <h2 className="mt-1.5 font-serif text-2xl text-ink">旅行记录</h2>
          <div className="mt-4 space-y-2">
            {[
              {
                icon: CalendarRange,
                label: "最长旅行",
                value: [...state.trips].sort(
                  (left, right) =>
                    tripDurationDays(right.startDate, right.endDate) -
                    tripDurationDays(left.startDate, left.endDate),
                )[0]?.title,
              },
              {
                icon: Wallet,
                label: "最高预算",
                value: [...state.trips].sort(
                  (left, right) =>
                    (right.budgetAmountMinor ?? 0) - (left.budgetAmountMinor ?? 0),
                )[0]?.title,
              },
              {
                icon: MapPin,
                label: "最常去国家",
                value: "日本 · 2 段",
              },
              {
                icon: Route,
                label: "最远目的地",
                value: "百内 · 巴塔哥尼亚",
              },
            ].map((record) => (
              <div
                key={record.label}
                className="flex items-start gap-3 rounded-control border border-hairline bg-surface-2 p-3"
              >
                <record.icon aria-hidden="true" className="mt-0.5 size-3.5 text-muted" />
                <div className="min-w-0">
                  <p className="font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                    {record.label}
                  </p>
                  <p className="mt-1 truncate text-[12px] text-ink">{record.value}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
            LAST ENTRY {state.entries[0] ? shortDate(state.entries[0].date) : "—"}
          </p>
        </section>
      </div>
    </div>
  );
}
