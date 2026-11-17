import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { MembersWorkspace } from "./members-workspace";

describe("MembersWorkspace", () => {
  it("invites a member, updates a role, and revokes a pending invitation", async () => {
    const user = userEvent.setup();
    renderWithDemo(<MembersWorkspace />);

    await user.click(screen.getByRole("button", { name: "邀请成员" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("邮箱"), "sora@example.com");
    await user.selectOptions(within(dialog).getByLabelText("角色"), "viewer");
    await user.type(within(dialog).getByLabelText("附言"), "一起记录京都。");
    await user.click(within(dialog).getByRole("button", { name: "发送邀请" }));

    expect(screen.getByText("sora@example.com")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("更改 顾南 的角色"), "admin");
    expect(screen.getByLabelText("更改 顾南 的角色")).toHaveValue("admin");

    const invitationRow = screen.getByText("daniel@atelier.co").closest("div");
    expect(invitationRow).not.toBeNull();
    await user.click(within(invitationRow as HTMLElement).getByRole("button", { name: "取消" }));
    expect(screen.queryByText("daniel@atelier.co")).not.toBeInTheDocument();
  });
});
