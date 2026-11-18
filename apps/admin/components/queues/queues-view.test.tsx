import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMutationPort } from "../../lib/admin-data-source";
import {
  MOCK_ADMIN_FAILED_JOBS,
  MOCK_ADMIN_QUEUES,
  type AdminQueueSummary,
} from "../../lib/ops-fixtures";
import { QueuesView } from "./queues-view";

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QueuesView", () => {
  it("requires an explicit target confirmation before retrying a failed job", async () => {
    const user = userEvent.setup();
    render(
      <QueuesView
        role="super_admin"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
      />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    await user.click(within(failedRow).getByRole("button", { name: "重试任务" }));

    const dialog = screen.getByRole("dialog", { name: "重试任务" });
    const confirm = within(dialog).getByRole("button", { name: "确认重试" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("输入任务 ID 确认"), "job-export-7781");
    await user.click(confirm);

    expect(screen.getByRole("status")).toHaveTextContent("已重新入队");
    expect(screen.queryByRole("row", { name: /job-export-7781/ })).not.toBeInTheDocument();
  });

  it("blocks queue retry and pause controls for analysts", () => {
    render(
      <QueuesView role="analyst" queues={MOCK_ADMIN_QUEUES} failedJobs={MOCK_ADMIN_FAILED_JOBS} />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("allows admin to retry failed jobs but not manage queue lifecycle", () => {
    render(
      <QueuesView role="admin" queues={MOCK_ADMIN_QUEUES} failedJobs={MOCK_ADMIN_FAILED_JOBS} />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空队列 media-processing" })).toBeDisabled();
    expect(
      screen.getByText("Admin 可重试失败任务；暂停、恢复与清空队列属于 super_admin 专属操作。"),
    ).toBeInTheDocument();
  });

  it("keeps retry and queue management disabled for support", () => {
    render(
      <QueuesView role="support" queues={MOCK_ADMIN_QUEUES} failedJobs={MOCK_ADMIN_FAILED_JOBS} />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空队列 media-processing" })).toBeDisabled();
  });

  it("allows super_admin to pause and clear a queue with confirmation", async () => {
    const user = userEvent.setup();
    render(
      <QueuesView
        role="super_admin"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
      />,
    );

    const pause = screen.getByRole("button", { name: "暂停队列 media-processing" });
    expect(pause).toBeEnabled();
    await user.click(pause);
    const pauseDialog = screen.getByRole("dialog", { name: "暂停队列" });
    await user.type(within(pauseDialog).getByLabelText("输入队列名称确认"), "media-processing");
    await user.click(within(pauseDialog).getByRole("button", { name: "确认暂停" }));
    expect(screen.getByRole("status")).toHaveTextContent("已暂停队列：media-processing");

    expect(screen.getByRole("button", { name: "清空队列 media-processing" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "清空队列 media-processing" }));
    const clearDialog = screen.getByRole("dialog", { name: "清空队列" });
    const clearConfirm = within(clearDialog).getByRole("button", { name: "确认清空" });
    expect(clearConfirm).toBeDisabled();
    await user.type(within(clearDialog).getByLabelText("输入队列名称确认"), "media-processing");
    await user.click(clearConfirm);

    expect(screen.getByRole("status")).toHaveTextContent("已清空失败任务：media-processing");
    expect(screen.queryByRole("row", { name: /job-media-2204/ })).not.toBeInTheDocument();
  });

  it("calls API queue lifecycle mutations in API mode", async () => {
    const user = userEvent.setup();
    const mutations = {
      pauseQueue: vi.fn().mockResolvedValue(undefined),
      resumeQueue: vi.fn().mockResolvedValue(undefined),
      clearQueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as AdminMutationPort;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: "1.0.0",
            environment: "development",
            nodeVersion: "v24",
            buildTime: null,
            startedAt: "2026-11-17T00:00:00.000Z",
            uptimeSeconds: 1,
            migration: { version: null, appliedAt: null },
            worker: {
              status: "up",
              version: "1.0.0",
              consumers: 2,
              signal: "consumer-clients",
              blockedConsumers: 2,
              lastJobAt: null,
              lastJobStatus: null,
              lastJobQueue: null,
            },
            checks: {},
            queues: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    renderWithClient(
      <QueuesView
        role="super_admin"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
        mode="api"
        mutations={mutations}
      />,
    );

    await user.click(screen.getByRole("button", { name: "暂停队列 media-processing" }));
    const pauseDialog = screen.getByRole("dialog", { name: "暂停队列" });
    await user.type(within(pauseDialog).getByLabelText("输入队列名称确认"), "media-processing");
    await user.click(within(pauseDialog).getByRole("button", { name: "确认暂停" }));
    expect(mutations.pauseQueue).toHaveBeenCalledWith("media-processing");

    await user.click(screen.getByRole("button", { name: "恢复队列 media-processing" }));
    const resumeDialog = screen.getByRole("dialog", { name: "恢复队列" });
    await user.type(within(resumeDialog).getByLabelText("输入队列名称确认"), "media-processing");
    await user.click(within(resumeDialog).getByRole("button", { name: "确认恢复" }));
    expect(mutations.resumeQueue).toHaveBeenCalledWith("media-processing");

    await user.click(screen.getByRole("button", { name: "清空队列 media-processing" }));
    const clearDialog = screen.getByRole("dialog", { name: "清空队列" });
    await user.type(within(clearDialog).getByLabelText("输入队列名称确认"), "media-processing");
    await user.click(within(clearDialog).getByRole("button", { name: "确认清空" }));
    expect(mutations.clearQueue).toHaveBeenCalledWith("media-processing");
  });

  it("renders the measured throughput total and the discovered queue count", () => {
    render(
      <QueuesView
        role="super_admin"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
      />,
    );

    // 12.4 + 8.1 + 0.7 + 3.6 = 24.8 jobs/min, and four queues are shown.
    expect(screen.getAllByText("24.8 jobs/min").length).toBeGreaterThan(0);
    expect(screen.getByText("跨 4 个队列（Redis 发现）")).toBeInTheDocument();
  });

  it("shows 未接入 instead of 0.0 when the throughput window is unavailable", () => {
    const queues: AdminQueueSummary[] = [
      { ...MOCK_ADMIN_QUEUES[0]!, throughputPerMinute: Number.NaN },
    ];
    render(<QueuesView role="super_admin" queues={queues} failedJobs={[]} />);

    expect(screen.getAllByText("未接入").length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\.0 jobs\/min/)).not.toBeInTheDocument();
  });

  it("renders an empty state when Redis discovers no queues", () => {
    render(<QueuesView role="super_admin" queues={[]} failedJobs={[]} />);

    expect(screen.getByText("未发现队列")).toBeInTheDocument();
    expect(screen.getByText("Redis 中未发现已注册队列")).toBeInTheDocument();
  });
});
