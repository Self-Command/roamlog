import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_CONTENT } from "../../lib/ops-fixtures";
import { ContentView } from "./content-view";

describe("ContentView", () => {
  it("soft deletes and restores content only after typing the target title", async () => {
    const user = userEvent.setup();
    render(<ContentView role="admin" items={MOCK_ADMIN_CONTENT} />);

    const flaggedRow = screen.getByRole("row", { name: /在直岛等一班末班船/ });
    await user.click(within(flaggedRow).getByRole("button", { name: "删除内容" }));

    const deleteDialog = screen.getByRole("dialog", { name: "删除内容" });
    const deleteConfirm = within(deleteDialog).getByRole("button", { name: "确认删除" });
    expect(deleteConfirm).toBeDisabled();
    await user.type(
      within(deleteDialog).getByLabelText("输入内容标题确认"),
      "在直岛等一班末班船",
    );
    await user.click(deleteConfirm);

    expect(within(flaggedRow).getByText("已删除")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("admin.content.delete");

    await user.selectOptions(screen.getByLabelText("内容状态"), "deleted");
    const deletedRow = screen.getByRole("row", { name: /在直岛等一班末班船/ });
    await user.click(within(deletedRow).getByRole("button", { name: "恢复内容" }));
    const restoreDialog = screen.getByRole("dialog", { name: "恢复内容" });
    await user.type(
      within(restoreDialog).getByLabelText("输入内容标题确认"),
      "在直岛等一班末班船",
    );
    await user.click(within(restoreDialog).getByRole("button", { name: "确认恢复" }));

    await user.selectOptions(screen.getByLabelText("内容状态"), "all");
    const restoredRow = screen.getByRole("row", { name: /在直岛等一班末班船/ });
    expect(within(restoredRow).getByText("已发布")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("admin.content.restore");
  });

  it("keeps moderation actions visible but disabled for analysts", () => {
    render(<ContentView role="analyst" items={MOCK_ADMIN_CONTENT} />);

    const firstRow = screen.getByRole("row", { name: /冬季瀨戶內海跳岛/ });
    expect(within(firstRow).getByRole("button", { name: "删除内容" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
    expect(screen.getByText(/Analyst 仅可查看/)).toBeInTheDocument();
  });

  it("shows reports as not wired in API mode instead of a fabricated zero", () => {
    render(<ContentView role="admin" items={MOCK_ADMIN_CONTENT} mode="api" />);

    // Header badge, per-row report cell, and the explainer all say 未接入.
    expect(screen.getAllByText("未接入").length).toBeGreaterThan(1);
    expect(screen.getByText("举报与审核队列未接入")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ reports/)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /待审核/ })).toBeDisabled();
  });

  it("keeps the flagged filter unavailable until a report source exists", () => {
    render(<ContentView role="admin" items={MOCK_ADMIN_CONTENT} />);

    // Fixture mode still carries demo report counts (0 + 2 + 3 + 0 + 0 + 0).
    expect(screen.getByText("5 reports")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "待审核" })).toBeEnabled();
  });
});
