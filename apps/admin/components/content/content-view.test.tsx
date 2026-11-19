import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContentView } from "./content-view";

const mocks = vi.hoisted(() => ({
  useAdminReports: vi.fn(),
  useAdminReportDetail: vi.fn(),
  useResolveReport: vi.fn(),
  reportFailure: vi.fn((error: unknown) =>
    error && typeof error === "object" && "failure" in error
      ? (error as { failure: unknown }).failure
      : null,
  ),
}));

vi.mock("./reports-data", () => mocks);

const NOW = "2026-11-19T08:00:00.000Z";

const item = {
  id: "01942f30-1200-7000-8000-000000000941",
  workspaceId: "01942f30-1200-7000-8000-000000000942",
  targetType: "trip" as const,
  targetId: "01942f30-1200-7000-8000-000000000943",
  reason: "spam" as const,
  detail: "刷屏广告",
  reporterId: "01942f30-1200-7000-8000-000000000944",
  status: "open" as const,
  resolvedById: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: NOW,
  target: {
    type: "trip" as const,
    id: "01942f30-1200-7000-8000-000000000943",
    title: "Kyoto in November",
    authorId: "01942f30-1200-7000-8000-000000000945",
    authorName: "Owner",
    workspaceId: "01942f30-1200-7000-8000-000000000942",
    workspaceName: "Studio",
    deletedAt: null,
    moderatedAt: null,
  },
  reportCount: 3,
  lastReportedAt: NOW,
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      items: [item],
      nextCursor: null,
      hasMore: false,
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function detail() {
  return {
    data: {
      report: item,
      reports: [item],
      actions: [
        {
          id: "01942f30-1200-7000-8000-000000000946",
          reportId: item.id,
          actorId: "01942f30-1200-7000-8000-000000000947",
          action: "warn" as const,
          note: "已警告",
          createdAt: NOW,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderView(role: "admin" | "analyst" = "admin") {
  return render(<ContentView role={role} />);
}

describe("ContentView", () => {
  it("renders the real queue rows with target summary, report count and status", () => {
    mocks.useAdminReports.mockReturnValue(page());
    mocks.useAdminReportDetail.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
    mocks.useResolveReport.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });

    renderView();

    expect(screen.getByRole("heading", { name: "内容审核" })).toBeInTheDocument();
    expect(screen.getByText("Kyoto in November")).toBeInTheDocument();
    expect(screen.getByText("Owner · Studio · 垃圾广告")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("passes the status, type, reason and date filters to the queue query", async () => {
    const user = userEvent.setup();
    mocks.useAdminReports.mockReturnValue(page());
    mocks.useAdminReportDetail.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
    mocks.useResolveReport.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });

    renderView();
    await user.selectOptions(screen.getByLabelText("内容类型"), "media");
    await user.selectOptions(screen.getByLabelText("举报原因"), "harassment");
    await user.click(screen.getByRole("tab", { name: "已裁决" }));

    const lastParams = mocks.useAdminReports.mock.calls.at(-1)?.[0];
    expect(lastParams).toMatchObject({ targetType: "media", reason: "harassment", status: "resolved" });
  });

  it("shows an honest empty state for an empty queue", () => {
    mocks.useAdminReports.mockReturnValue(
      page({ data: { items: [], nextCursor: null, hasMore: false } }),
    );
    mocks.useAdminReportDetail.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
    mocks.useResolveReport.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });

    renderView();

    expect(screen.getByText("暂无待处理举报")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the API error and retries the real request", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mocks.useAdminReports.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      refetch,
      error: {
        failure: {
          code: "ADMIN_ACTION_FORBIDDEN",
          status: 403,
          title: "Forbidden",
          detail: "Your platform role does not permit this Admin action.",
          degraded: [],
        },
      },
    });
    mocks.useAdminReportDetail.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
    mocks.useResolveReport.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });

    renderView("analyst");

    expect(screen.getByText(/ADMIN_ACTION_FORBIDDEN/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("opens the detail drawer, submits a decision and re-pulls the queue", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    const mutate = vi.fn();
    const detailRefetch = vi.fn();

    mocks.useAdminReports.mockReturnValue(page({ refetch }));
    mocks.useAdminReportDetail.mockReturnValue({ ...detail(), refetch: detailRefetch });
    mocks.useResolveReport.mockReturnValue({ mutate, isPending: false, error: null });

    renderView();
    await user.click(screen.getByRole("button", { name: "查看详情" }));

    expect(await screen.findByText("内容快照 / 只读")).toBeInTheDocument();
    expect(screen.getByText("刷屏广告")).toBeInTheDocument();
    expect(screen.getByText("已警告")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提交裁决" }));
    expect(mutate).toHaveBeenCalledWith({ id: item.id, action: "remove", note: "" });

    // The success callback passed to the mutation re-pulls the queue.
    const onResolved = mocks.useResolveReport.mock.calls.at(-1)?.[0] as () => void;
    onResolved();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("keeps decisions disabled for read-only analysts", async () => {
    const user = userEvent.setup();
    mocks.useAdminReports.mockReturnValue(page());
    mocks.useAdminReportDetail.mockReturnValue(detail());
    mocks.useResolveReport.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });

    renderView("analyst");
    await user.click(screen.getByRole("button", { name: "查看详情" }));

    expect(await screen.findByText(/当前角色没有裁决权限/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交裁决" })).toBeDisabled();
  });
});