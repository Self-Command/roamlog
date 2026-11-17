import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_FAILED_JOBS, MOCK_ADMIN_QUEUES } from "../../lib/ops-fixtures";
import { QueuesView } from "./queues-view";

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
      <QueuesView
        role="analyst"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
      />,
    );

    const failedRow = screen.getByRole("row", { name: /job-export-7781/ });
    expect(within(failedRow).getByRole("button", { name: "重试任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "暂停队列 media-processing" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("allows admin to retry failed jobs but not manage queue lifecycle", () => {
    render(
      <QueuesView
        role="admin"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
      />,
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
      <QueuesView
        role="support"
        queues={MOCK_ADMIN_QUEUES}
        failedJobs={MOCK_ADMIN_FAILED_JOBS}
      />,
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

    expect(
      screen.getByRole("button", { name: "清空队列 media-processing" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "清空队列 media-processing" }));
    const clearDialog = screen.getByRole("dialog", { name: "清空队列" });
    const clearConfirm = within(clearDialog).getByRole("button", { name: "确认清空" });
    expect(clearConfirm).toBeDisabled();
    await user.type(
      within(clearDialog).getByLabelText("输入队列名称确认"),
      "media-processing",
    );
    await user.click(clearConfirm);

    expect(screen.getByRole("status")).toHaveTextContent("已清空失败任务：media-processing");
    expect(screen.queryByRole("row", { name: /job-media-2204/ })).not.toBeInTheDocument();
  });
});
