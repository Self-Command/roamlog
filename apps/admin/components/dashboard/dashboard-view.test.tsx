import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_DASHBOARD } from "../../lib/fixtures";
import { DashboardView } from "./dashboard-view";

describe("DashboardView", () => {
  it("shows dense metrics, an accessible trend, and queue/email health", () => {
    render(<DashboardView data={MOCK_ADMIN_DASHBOARD} role="support" />);

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
});
