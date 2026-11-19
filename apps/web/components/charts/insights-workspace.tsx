"use client";

import { Badge, Button, EmptyState, ErrorState, PageHeader, Skeleton } from "@roamlog/ui";
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

import { useInsightsData } from "./insights-data";
import {
  AnnualTripsChart,
  BudgetCompositionChart,
  CategoryMixChart,
  ChartReveal,
  MonthlySpendChart,
} from "./insights-charts";
import {
  aggregateTripStats,
  annualTrips,
  budgetRows,
  categoryColors,
  categoryLabels,
  categoryTotals,
  expenseCsv,
  formatMoney,
  heatmapRows,
  insightRecords,
  monthlySpend,
  totalByCurrency,
} from "./insights-model";

function InsightsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-12 w-56" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-none" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-72 rounded-card lg:col-span-4" />
        <Skeleton className="h-72 rounded-card lg:col-span-8" />
        <Skeleton className="h-64 rounded-card lg:col-span-5" />
        <Skeleton className="h-64 rounded-card lg:col-span-7" />
      </div>
    </div>
  );
}

export function InsightsWorkspace({ workspaceSlug }: { workspaceSlug: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const {
    workspace,
    workspacesQuery,
    tripsQuery,
    trips,
    tripsTruncated,
    entries,
    expenses,
    secondaryLoading,
    secondaryError,
    truncated,
    retrySecondary,
  } = useInsightsData(workspaceSlug);

  const stats = useMemo(() => aggregateTripStats(trips), [trips]);
  const annual = useMemo(() => annualTrips(trips), [trips]);
  const currency = workspace?.defaultCurrency ?? "CNY";
  const displayExpenses = useMemo(
    () => expenses.filter((expense) => expense.currency === currency),
    [currency, expenses],
  );
  const monthly = useMemo(() => monthlySpend(displayExpenses, currency), [currency, displayExpenses]);
  const monthlyTotal = monthly.reduce((sum, point) => sum + point.amountMinor, 0);
  const categories = useMemo(
    () => categoryTotals(expenses, currency),
    [currency, expenses],
  );
  const categoryTotal = categories.reduce((sum, item) => sum + item.total, 0);
  const budgets = useMemo(() => budgetRows(trips, expenses), [expenses, trips]);
  const heatmap = useMemo(() => heatmapRows(entries, expenses), [entries, expenses]);
  const records = useMemo(() => insightRecords(trips, entries), [entries, trips]);
  const currencyTotals = useMemo(() => totalByCurrency(expenses), [expenses]);
  const displayTotal = currencyTotals.find((total) => total.currency === currency);
  const otherCurrencies = currencyTotals.filter((total) => total.currency !== currency);

  function exportCsv() {
    if (expenses.length === 0) return;
    const blob = new Blob([expenseCsv(expenses, trips)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "roamlog-expenses.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${expenses.length} 笔真实支出记录。`);
  }

  if (workspacesQuery.isLoading || tripsQuery.isLoading) {
    return <InsightsLoading />;
  }

  if (!workspace || tripsQuery.isError || !tripsQuery.data) {
    return (
      <ErrorState
        title="洞察暂时不可用"
        description="工作区或旅行列表没有返回。请检查网络与 API 状态后重试。"
        retryAction={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void workspacesQuery.refetch();
              void tripsQuery.refetch();
            }}
          >
            重新加载
          </Button>
        }
      />
    );
  }

  const header = (
    <>
      <PageHeader
        eyebrow={`INSIGHTS / ${stats.years.length ? `${stats.years[0]}—${stats.years.at(-1)}` : "NO DATA"}`}
        title="旅行洞察"
        description="年度旅行、支出、分类与记录热力图，全部来自当前工作区的真实数据；无法计算的指标会明确标注。"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={expenses.length === 0}
          >
            <Download aria-hidden="true" />
            导出支出
          </Button>
        }
      />
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}
    </>
  );

  if (trips.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          className="mt-6"
          icon={Plane}
          title="还没有足够的旅行数据"
          description="创建旅行并记录支出与日志后，洞察会基于真实数据生成年度、分类与热力图。"
        />
      </div>
    );
  }

  if (secondaryLoading) {
    return <InsightsLoading />;
  }

  if (secondaryError) {
    return (
      <ErrorState
        title="洞察数据读取失败"
        description="旅行、日志或支出记录没有完整返回。请稍后重试。"
        retryAction={
          <Button type="button" variant="primary" onClick={retrySecondary}>
            重新加载
          </Button>
        }
      />
    );
  }

  const spentValue = displayTotal ? formatMoney(displayTotal.amountMinor, currency) : "—";
  const spentHint =
    expenses.length === 0
      ? "尚未有支出记录"
      : displayTotal
        ? `${displayExpenses.length} 笔 ${currency} 明细`
        : `仅有其他币种支出，未折算为 ${currency}`;

  return (
    <div className="space-y-4">
      {header}

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline xl:grid-cols-4">
        {[
          { label: "旅行次数", value: stats.tripCount, hint: "含愿望与计划", icon: Plane },
          { label: "旅行天数", value: stats.totalDays, hint: "按真实起止日期计算", icon: CalendarRange },
          {
            label: "国家 / 地区",
            value: stats.countries,
            hint: `${stats.cities} 座城市`,
            icon: Globe2,
          },
          {
            label: "总支出",
            value: spentValue,
            hint: spentHint,
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

      {tripsTruncated || truncated ? (
        <p
          role="status"
          className="rounded-control border border-accent-yellow/20 bg-accent-yellow/5 px-3 py-2 text-[11px] text-accent-yellow"
        >
          当前最多加载前 100 趟旅行与 20 页记录，统计范围是已加载的真实数据；完整分页尚未接入。
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="surface-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">ANNUAL TRIPS</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">年度旅行次数</h2>
            </div>
            <Badge tone="neutral">{stats.tripCount}</Badge>
          </div>
          <ChartReveal>
            <AnnualTripsChart data={annual} />
          </ChartReveal>
        </section>

        <section className="surface-card p-5 lg:col-span-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="type-eyebrow">MONTHLY SPEND</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">月度支出节奏</h2>
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
              LAST 12 MONTHS · {formatMoney(monthlyTotal, currency)}
            </p>
          </div>
          {monthlyTotal === 0 ? (
            <EmptyState
              className="mt-4 px-4 py-10"
              title="最近 12 个月没有支出记录"
              description={`记录 ${currency} 支出后，这里会显示真实的月度节奏。`}
            />
          ) : (
            <ChartReveal>
              <MonthlySpendChart points={monthly} currency={currency} />
            </ChartReveal>
          )}
          {otherCurrencies.length > 0 ? (
            <p className="mt-3 font-mono text-[9px] text-stone">
              其他币种支出未折算：
              {otherCurrencies
                .map((total) => formatMoney(total.amountMinor, total.currency))
                .join(" · ")}
            </p>
          ) : null}
        </section>

        <section className="surface-card p-5 lg:col-span-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">CATEGORY MIX</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">分类支出</h2>
            </div>
            <Badge tone="neutral">{displayExpenses.length} 笔</Badge>
          </div>
          {categories.length === 0 ? (
            <EmptyState
              className="mt-4 px-4 py-10"
              title="还没有分类支出"
              description={`记录 ${currency} 支出后，这里会按真实分类汇总。`}
            />
          ) : (
            <>
              {/* 环形图不再输出图例：分类标签与金额保留在下方 DOM 明细里，避免重复文本。 */}
              <ChartReveal>
                <CategoryMixChart items={categories} currency={currency} />
              </ChartReveal>
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
                        {formatMoney(item.total, currency)} ·{" "}
                        {Math.round((item.total / Math.max(1, categoryTotal)) * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="surface-card p-5 lg:col-span-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="type-eyebrow">BUDGET / SPENT</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">预算对比</h2>
            </div>
            <span className="font-mono text-[9px] uppercase text-stone">TOP 6 BUDGETS</span>
          </div>
          {budgets.length === 0 ? (
            <EmptyState
              className="mt-4 px-4 py-10"
              title="还没有设置预算"
              description="为旅行填写预算后，这里会对比同币种的真实支出。"
            />
          ) : (
            <div className="mt-4 space-y-4">
              <ChartReveal>
                <BudgetCompositionChart rows={budgets} />
              </ChartReveal>
              <p className="text-[9px] text-stone">
                堆叠条按每趟旅行自身预算的百分比绘制，避免不同币种直接比较长度；金额见下方明细。
              </p>
              <div className="space-y-3">
                {budgets.map(({ trip, currency: budgetCurrency, budgetAmountMinor, spentAmountMinor, hasOtherCurrencySpend }) => {
                  const percent = Math.round((spentAmountMinor / Math.max(1, budgetAmountMinor)) * 100);
                  return (
                    <div key={trip.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-body">{trip.title}</p>
                        <p className="mt-0.5 font-mono text-[8px] uppercase text-stone">
                          {trip.destinations[0] ?? "—"} · {percent}%
                          {hasOtherCurrencySpend ? " · 其他币种未计入" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {formatMoney(spentAmountMinor, budgetCurrency)} /{" "}
                        {formatMoney(budgetAmountMinor, budgetCurrency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
          {heatmap.length === 0 ? (
            <EmptyState
              className="mt-4 px-4 py-10"
              title="还没有日志或支出记录"
              description="记录日志或支出后，这里会显示真实的月度活跃热力图。"
            />
          ) : (
            /* 热力图保持现有 DOM 网格：图表库版本多 +136KB 且 a11y 更差，这里只补入场动画。 */
            <ChartReveal className="mt-4 overflow-x-auto">
              <div className="space-y-2">
                {heatmap.map((row) => (
                  <div key={row.year} className="flex min-w-[520px] items-center gap-2">
                    <span className="w-10 shrink-0 font-mono text-[8px] text-stone">
                      {row.year}
                    </span>
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
            </ChartReveal>
          )}
        </section>

        <section className="surface-card p-5 lg:col-span-4">
          <p className="type-eyebrow">TRAVEL RECORDS</p>
          <h2 className="mt-1.5 font-serif text-2xl text-ink">旅行记录</h2>
          <div className="mt-4 space-y-2">
            {[
              {
                icon: CalendarRange,
                label: "最长旅行",
                value: records.longestTrip,
                hint: "按真实起止天数",
              },
              {
                icon: Wallet,
                label: "最高预算",
                value: records.highestBudget,
                hint: "按旅行预算设置值",
              },
              {
                icon: MapPin,
                label: "最常去国家",
                value: records.mostVisitedCountry,
                hint: "按真实国家码统计",
              },
              {
                icon: Route,
                label: "路线距离",
                value: "—",
                hint: "尚未接入",
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
                  <p className="mt-0.5 text-[9px] text-stone">{record.hint}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
            LAST ENTRY {records.lastEntryDate}
          </p>
        </section>
      </div>

      <p className="text-[10px] leading-5 text-stone">
        多币种统一换算与路线距离聚合尚未接入：支出按币种分别统计，未做汇率折算；距离指标显示 —。
      </p>
    </div>
  );
}