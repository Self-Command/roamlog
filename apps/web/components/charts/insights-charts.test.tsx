import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTrip } from "@/test/fake-data";

import { stubChartLayout } from "./chart-test-setup";
import { cn } from "./chart-container";
import {
  AnnualTripsChart,
  BudgetCompositionChart,
  CategoryMixChart,
  ChartReveal,
  MonthlySpendChart,
} from "./insights-charts";
import type { BudgetRow, MonthlySpendPoint } from "./insights-model";

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function monthlyPoints(): MonthlySpendPoint[] {
  return [
    { key: "2026-10", label: "10月", amountMinor: 0 },
    { key: "2026-11", label: "11月", amountMinor: 123_400 },
  ];
}

function budgetRow(overrides: Partial<BudgetRow> = {}): BudgetRow {
  return {
    trip: makeTrip({ id: "0198f000-0000-7000-8000-000000000090" }),
    currency: "CNY",
    budgetAmountMinor: 500_000,
    spentAmountMinor: 123_400,
    hasOtherCurrencySpend: false,
    ...overrides,
  };
}

beforeEach(() => {
  stubChartLayout();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("charts primitives", () => {
  it("merges conditional class names without extra dependencies", () => {
    expect(cn("a", false, null, undefined, ["b", ["c"]], 0)).toBe("a b c");
  });

  it("honours the shadcn chart container contract", () => {
    const { container } = render(
      <AnnualTripsChart data={[["2025", 1], ["2026", 2]]} />,
    );

    const chart = container.querySelector("[data-slot='chart']");
    expect(chart).not.toBeNull();
    expect(chart?.getAttribute("data-chart")).toMatch(/^chart-/);
    expect(container.querySelector("style")?.innerHTML).toContain(
      "--color-trips: var(--accent-orange);",
    );
    expect(
      screen.getByRole("group", { name: /年度旅行次数柱状图：2025 年 1 次，2026 年 2 次/ }),
    ).toBeInTheDocument();
    // Recharts 3 `accessibilityLayer` stays at its `true` default.
    const surface = container.querySelector(".recharts-surface");
    expect(surface?.getAttribute("role")).toBe("application");
    expect(surface?.getAttribute("tabindex")).toBe("0");
  });

  it("renders the monthly area, the category donut and the budget stack", () => {
    // Reduced motion keeps the marks static, which is how the geometry is
    // asserted; the animated path is covered by the motion guard tests below.
    mockMatchMedia(true);

    const { container: areaContainer } = render(
      <MonthlySpendChart points={monthlyPoints()} currency="CNY" />,
    );
    expect(areaContainer.querySelector(".recharts-area")).not.toBeNull();
    expect(
      screen.getByRole("group", { name: "最近十二个月支出面积图" }),
    ).toBeInTheDocument();

    const { container: donutContainer } = render(
      <CategoryMixChart
        currency="CNY"
        items={[
          { category: "food", total: 123_400 },
          { category: "transport", total: 50_000 },
        ]}
      />,
    );
    expect(
      donutContainer.querySelectorAll(".recharts-pie-sector path").length,
    ).toBe(2);
    expect(donutContainer.querySelector("style")?.innerHTML).toContain(
      "--color-transport: var(--accent-blue);",
    );
    // Category labels stay in the DOM list, never duplicated by a chart legend.
    expect(screen.queryByText("餐饮")).toBeNull();

    const { container: budgetContainer } = render(
      <BudgetCompositionChart
        rows={[
          budgetRow(),
          budgetRow({
            trip: makeTrip({
              id: "0198f000-0000-7000-8000-000000000091",
              title: "超支旅行",
            }),
            budgetAmountMinor: 100_000,
            spentAmountMinor: 150_000,
          }),
        ]}
      />,
    );
    expect(budgetContainer.querySelectorAll(".recharts-bar").length).toBe(3);
    const budgetStyle = budgetContainer.querySelector("style")?.innerHTML ?? "";
    expect(budgetStyle).toContain("--color-spent: var(--accent-orange);");
    expect(budgetStyle).toContain("--color-over: var(--accent-red);");
    expect(budgetStyle).toContain("--color-remaining: var(--hairline-strong);");
    // Row 1 (within budget): 已用 + 剩余. Row 2 (overspent): 已用 + 超支.
    expect(
      budgetContainer.querySelectorAll(".recharts-bar-rectangle path").length,
    ).toBe(4);
    expect(budgetContainer.innerHTML).toContain('fill="var(--color-over)"');
  });
});

describe("chart motion guards", () => {
  it("runs the one-shot entrance animation only when motion is allowed", () => {
    mockMatchMedia(false);
    const { container } = render(
      <ChartReveal>
        <span>chart</span>
      </ChartReveal>,
    );

    expect(container.firstElementChild?.className).toContain(
      "roamlog-chart-enter--run",
    );
  });

  it("drops the entrance animation when the user prefers reduced motion", () => {
    mockMatchMedia(true);
    const { container } = render(
      <ChartReveal>
        <span>chart</span>
      </ChartReveal>,
    );

    expect(container.firstElementChild?.className).toContain("roamlog-chart-enter");
    expect(container.firstElementChild?.className).not.toContain(
      "roamlog-chart-enter--run",
    );
  });

  it("keeps the chart mounted and static with reduced motion on", () => {
    mockMatchMedia(true);
    const { container } = render(<AnnualTripsChart data={[["2026", 3]]} />);

    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-bar-rectangle")).not.toBeNull();
  });
});
