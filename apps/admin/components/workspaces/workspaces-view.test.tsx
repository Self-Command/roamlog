import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_WORKSPACES } from "../../lib/fixtures";
import { WorkspacesView } from "./workspaces-view";

describe("WorkspacesView", () => {
  it("requires the workspace name before suspension can be confirmed", async () => {
    const user = userEvent.setup();
    render(<WorkspacesView role="support" workspaces={MOCK_ADMIN_WORKSPACES} />);

    const firstRow = screen.getByRole("row", { name: /Roamlog Crew/ });
    expect(within(firstRow).getByRole("button", { name: "删除工作区" })).toBeDisabled();
    await user.click(within(firstRow).getByRole("button", { name: "暂停工作区" }));

    const dialog = screen.getByRole("dialog", { name: "暂停工作区" });
    const confirm = within(dialog).getByRole("button", { name: "确认暂停" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("输入工作区名称确认"), "Roamlog Crew");
    await user.click(confirm);

    expect(within(firstRow).getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("模拟审计事件已记录");
  });

  it("keeps workspace destructive actions disabled for analysts", () => {
    render(<WorkspacesView role="analyst" workspaces={MOCK_ADMIN_WORKSPACES} />);

    const firstRow = screen.getByRole("row", { name: /Roamlog Crew/ });
    expect(within(firstRow).getByRole("button", { name: "暂停工作区" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "删除工作区" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });
});
