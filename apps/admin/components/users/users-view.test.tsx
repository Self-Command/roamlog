import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_USERS } from "../../lib/fixtures";
import { UsersView } from "./users-view";

describe("UsersView", () => {
  it("requires typing the target name before a destructive action can be confirmed", async () => {
    const user = userEvent.setup();
    render(<UsersView role="support" users={MOCK_ADMIN_USERS} />);

    const firstRow = screen.getByRole("row", { name: /林知夏/ });
    expect(within(firstRow).getByRole("button", { name: "修改平台角色" })).toBeDisabled();
    await user.click(within(firstRow).getByRole("button", { name: "暂停账户" }));

    const dialog = screen.getByRole("dialog", { name: "暂停账户" });
    const confirm = within(dialog).getByRole("button", { name: "确认暂停" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("输入用户姓名确认"), "林知夏");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(screen.queryByRole("dialog", { name: "暂停账户" })).not.toBeInTheDocument();
    expect(within(firstRow).getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("模拟审计事件已记录");
  });

  it("keeps every destructive user action visible but disabled for analysts", () => {
    render(<UsersView role="analyst" users={MOCK_ADMIN_USERS} />);

    const firstRow = screen.getByRole("row", { name: /林知夏/ });
    expect(within(firstRow).getByRole("button", { name: "暂停账户" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "修改平台角色" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "删除用户" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("allows support to suspend but not change platform roles", async () => {
    const user = userEvent.setup();
    render(<UsersView role="support" users={MOCK_ADMIN_USERS} />);

    const firstRow = screen.getByRole("row", { name: /林知夏/ });
    const suspend = within(firstRow).getByRole("button", { name: "暂停账户" });
    expect(suspend).toBeEnabled();
    expect(within(firstRow).getByRole("button", { name: "修改平台角色" })).toBeDisabled();

    await user.click(suspend);
    expect(screen.getByRole("dialog", { name: "暂停账户" })).toBeInTheDocument();
  });
});
