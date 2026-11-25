import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMutationPort } from "../../lib/admin-data-source";
import type { AdminQueueSummary } from "../../lib/admin-ops-types";
import { sampleFailedJobs, sampleQueues } from "../../test/admin-sample-data";
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
    renderWithClient(
      <QueuesView
        role="super_admin"
        queues={sampleQueues}
        failedJobs={sampleFailedJobs}
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
    renderWithClient(
      <QueuesView role="analyst" queues={sampleQueues} failedJobs={sampleFailedJobs} />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("allows admin to retry failed jobs but not manage queue lifecycle", () => {
    renderWithClient(
      <QueuesView role="admin" queues={sampleQueues} failedJobs={sampleFailedJobs} />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空队列 media-processing" })).toBeDisabled();
    expect(
      screen.getByText(/暂停、恢复与清空队列仅超级管理员可执行/),
    ).toBeInTheDocument();
  });

  it("keeps retry and queue management disabled for support", () => {
    renderWithClient(
      <QueuesView role="support" queues={sampleQueues} failedJobs={sampleFailedJobs} />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空队列 media-processing" })).toBeDisabled();
  });

  it("allows super_admin to pause and clear a queue with confirmation", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <QueuesView
        role="super_admin"
        queues={sampleQueues}
        failedJobs={sampleFailedJobs}
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
        queues={sampleQueues}
        failedJobs={sampleFailedJobs}
       
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
    renderWithClient(
      <QueuesView
        role="super_admin"
        queues={sampleQueues}
        failedJobs={sampleFailedJobs}
      />,
    );

    // 12.4 + 8.1 + 0.7 + 3.6 = 24.8 任务/分钟，并展示四个队列。
    expect(screen.getAllByText("24.8 任务/分钟").length).toBeGreaterThan(0);
    expect(screen.getByText("共 4 个任务队列")).toBeInTheDocument();
  });

  it("shows 暂不可用 instead of 0.0 when the throughput window is unavailable", () => {
    const queues: AdminQueueSummary[] = [
      { ...sampleQueues[0]!, throughputPerMinute: Number.NaN },
    ];
    renderWithClient(<QueuesView role="super_admin" queues={queues} failedJobs={[]} />);

    expect(screen.getAllByText("暂不可用").length).toBeGreaterThan(0);
    expect(screen.queryByText("未接入")).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.0 jobs\/min/)).not.toBeInTheDocument();
  });

  it("renders an empty state when Redis discovers no queues", () => {
    renderWithClient(<QueuesView role="super_admin" queues={[]} failedJobs={[]} />);

    expect(screen.getByText("未发现队列")).toBeInTheDocument();
    expect(screen.getByText("当前没有已注册的任务队列")).toBeInTheDocument();
  });
});
