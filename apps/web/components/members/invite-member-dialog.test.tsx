import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import type { InvitationInput } from "@/lib/api/types";

import { inviteErrorMessage } from "./invite-errors";
import { InviteMemberDialog } from "./invite-member-dialog";

function renderDialog(onInvite: (input: InvitationInput) => Promise<void>, pending = false) {
  const onOpenChange = vi.fn();
  render(
    <InviteMemberDialog open pending={pending} onInvite={onInvite} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange };
}

async function fillInvite(email = "traveler@example.com") {
  const user = userEvent.setup();
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/邮箱/u), email);
  await user.selectOptions(within(dialog).getByLabelText(/角色/u), "admin");
  await user.type(within(dialog).getByLabelText(/留言（可选）/u), "一起记录这趟旅行。");
  return { user, dialog };
}

describe("inviteErrorMessage", () => {
  it.each([
    ["EMAIL_VERIFICATION_REQUIRED", 403, "请先完成邮箱验证"],
    ["MEMBER_ALREADY_EXISTS", 409, "已经是工作区成员"],
    ["INVITATION_ALREADY_PENDING", 409, "已有一条待接受的邀请"],
    ["INVITATION_DELIVERY_FAILED", 503, "邀请没有保存"],
  ])("maps %s to actionable copy", (code, status, expected) => {
    expect(inviteErrorMessage(new ApiError(status, "provider detail", code))).toContain(expected);
  });

  it("does not expose server details for unknown failures", () => {
    const message = inviteErrorMessage(
      new ApiError(500, "SMTP EAUTH 535 with internal host and secret", "UNKNOWN"),
    );
    expect(message).not.toContain("EAUTH");
    expect(message).not.toContain("SMTP");
    expect(message).toContain("请稍后重试");
  });

  it("maps 403, 429, validation and network failures", () => {
    expect(inviteErrorMessage(new ApiError(403, "Forbidden"))).toContain("没有邀请成员的权限");
    expect(inviteErrorMessage(new ApiError(429, "Too many requests"))).toContain("过于频繁");
    expect(inviteErrorMessage(new ApiError(422, "Invalid email"))).toContain("检查邮箱和角色");
    expect(inviteErrorMessage(new ApiError(0, "Failed to fetch"))).toContain("检查网络连接");
    expect(inviteErrorMessage(new TypeError("Failed to fetch"))).toContain("检查网络连接");
  });
});

describe("InviteMemberDialog", () => {
  it("keeps a delivery failure inside the open dialog and preserves input", async () => {
    const onInvite = vi
      .fn<(input: InvitationInput) => Promise<void>>()
      .mockRejectedValue(
        new ApiError(
          503,
          "The invitation could not be delivered. No pending invitation was left behind.",
          "INVITATION_DELIVERY_FAILED",
        ),
      );
    renderDialog(onInvite);
    const { user, dialog } = await fillInvite();

    await user.click(within(dialog).getByRole("button", { name: "发送邀请" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("邮件服务暂时不可用");
    expect(alert).toHaveTextContent("邀请没有保存");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(within(dialog).getByLabelText(/邮箱/u)).toHaveValue("traveler@example.com");
    expect(within(dialog).getByLabelText(/角色/u)).toHaveValue("admin");
    expect(within(dialog).getByLabelText(/留言（可选）/u)).toHaveValue("一起记录这趟旅行。");
    expect(within(dialog).getByRole("button", { name: "发送邀请" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it.each([
    [new ApiError(403, "Forbidden"), "没有邀请成员的权限"],
    [new ApiError(429, "Too many requests"), "邀请发送过于频繁"],
    [new TypeError("Failed to fetch"), "检查网络连接"],
  ])("shows an accessible retryable error for %s", async (cause, expected) => {
    const onInvite = vi.fn<(input: InvitationInput) => Promise<void>>().mockRejectedValue(cause);
    renderDialog(onInvite);
    const { user, dialog } = await fillInvite();

    await user.click(within(dialog).getByRole("button", { name: "发送邀请" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    expect(within(dialog).getByRole("button", { name: "发送邀请" })).toBeEnabled();
  });

  it("closes only after the parent confirms a successful invite", async () => {
    const user = userEvent.setup();
    const onInvite = vi.fn<(input: InvitationInput) => Promise<void>>().mockResolvedValue();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <InviteMemberDialog
          open={open}
          pending={false}
          onInvite={async (input) => {
            await onInvite(input);
            setOpen(false);
          }}
          onOpenChange={setOpen}
        />
      );
    }

    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/邮箱/u), "new-member@example.com");
    await user.click(within(dialog).getByRole("button", { name: "发送邀请" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onInvite).toHaveBeenCalledWith({
      email: "new-member@example.com",
      role: "editor",
    });
  });

  it("blocks duplicate submits while the request is pending", async () => {
    let resolveInvite: (() => void) | undefined;
    const onInvite = vi.fn<(input: InvitationInput) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          resolveInvite = resolve;
        }),
    );
    renderDialog(onInvite);
    const { user, dialog } = await fillInvite();

    await user.click(within(dialog).getByRole("button", { name: "发送邀请" }));
    const pendingButton = within(dialog).getByRole("button", { name: "发送中…" });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(onInvite).toHaveBeenCalledTimes(1);

    resolveInvite?.();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "发送邀请" })).toBeEnabled(),
    );
  });
});
