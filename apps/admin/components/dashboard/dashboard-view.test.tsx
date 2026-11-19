import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminDashboardSourceState } from "../../lib/admin-data-source";
import { sampleDashboard } from "../../test/admin-sample-data";
import { DashboardView } from "./dashboard-view";

function readySource(): AdminDashboardSourceState {
  return { status: "ready", error: null, refetch: vi.fn() };
}

function failedSource(code: string, refetch = vi.fn()): AdminDashboardSourceState {
  return {
    status: "error",
    error: {
      code,
      status: 503,
      title: "Data source unavailable",
      detail: `${code} detail`,
      degraded: [],
    },
    refetch,
  };
}

describe("DashboardView", () => {
  it("shows dense metrics, an accessible trend, and queue/email health", () => {
    render(<DashboardView data={sampleDashboard} role="support" />);

    expect(screen.getByRole("heading", { name: "平台总览" })).toBeInTheDocument();
    const metrics = screen.getByRole("region", { name: "核心指标" });
    expect(within(metrics).getByText("用户总数")).toBeInTheDocument();
    expect(within(metrics).getByText("工作区")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "用户与工作区 12 日趋势图" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "队列健康" })).toBeInTheDocument();
    expect(screen.getByText("media-processing")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "邮件健康" })).toBeInTheDocument();
    expect(screen.getByText("126,482")).toBeInTheDocument();
  });

  it("degrades only email health when the emails source fails", () => {
    const retryEmails = vi.fn();
    render(
      <DashboardView
        data={{
          ...sampleDashboard,
          sources: {
            metrics: readySource(),
            audit: readySource(),
            emails: failedSource("EMAILS_UNAVAILABLE", retryEmails),
          },
        }}
        role="support"
      />,
    );

    expect(screen.getByText("1.8万")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近审计事件" })).toBeInTheDocument();
    const emailHealth = screen.getByRole("region", { name: "邮件健康" });
    expect(within(emailHealth).getByRole("alert")).toHaveTextContent("EMAILS_UNAVAILABLE");
    expect(within(emailHealth).queryByText("126,482")).not.toBeInTheDocument();

    fireEvent.click(within(emailHealth).getByRole("button", { name: "重试" }));
    expect(retryEmails).toHaveBeenCalledTimes(1);
  });

  it("degrades only recent audit when the audit source fails", () => {
    render(
      <DashboardView
        data={{
          ...sampleDashboard,
          sources: {
            metrics: readySource(),
            audit: failedSource("AUDIT_UNAVAILABLE"),
            emails: readySource(),
          },
        }}
        role="support"
      />,
    );

    expect(screen.getByText("1.8万")).toBeInTheDocument();
    expect(screen.getByText("126,482")).toBeInTheDocument();
    const recentAudit = screen.getByRole("region", { name: "最近审计事件" });
    expect(within(recentAudit).getByRole("alert")).toHaveTextContent("AUDIT_UNAVAILABLE");
  });

  it("degrades metrics-dependent blocks without hiding audit or email health", () => {
    render(
      <DashboardView
        data={{
          ...sampleDashboard,
          sources: {
            metrics: failedSource("METRICS_UNAVAILABLE"),
            audit: readySource(),
            emails: readySource(),
          },
        }}
        role="support"
      />,
    );

    const metrics = screen.getByRole("region", { name: "核心指标" });
    expect(within(metrics).getByRole("alert")).toHaveTextContent("METRICS_UNAVAILABLE");
    expect(screen.queryByText("用户总数")).not.toBeInTheDocument();
    expect(screen.getByText("126,482")).toBeInTheDocument();
    const recentAudit = screen.getByRole("region", { name: "最近审计事件" });
    expect(within(recentAudit).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(recentAudit).getByText(sampleDashboard.recentAudit[0]?.action ?? "missing"),
    ).toBeInTheDocument();
  });
});
