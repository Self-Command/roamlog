import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareLinkDialog } from "../share-link-dialog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CREATED = {
  id: "0193d3a0-0000-7000-8000-000000000001",
  workspaceId: "0193d3a0-0000-7000-8000-000000000002",
  tripId: "0193d3a0-0000-7000-8000-000000000003",
  createdById: "0193d3a0-0000-7000-8000-000000000004",
  expiresAt: null,
  revokedAt: null,
  hasPassword: true,
  allowIndex: false,
  showBudget: true,
  lastAccessedAt: null,
  accessCount: 0,
  createdAt: "2026-11-19T00:00:00.000Z",
  token: "0123456789abcdef0123456789abcdef",
  url: "https://roamlog.test/share/0123456789abcdef0123456789abcdef",
};

describe("ShareLinkDialog copy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Chinese badges and never calls the link a token", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(CREATED, 201)),
    );

    render(<ShareLinkDialog tripId={CREATED.tripId} />);

    await user.click(screen.getByRole("button", { name: "分享" }));
    await user.type(screen.getByLabelText("访问密码（可选）"), "roamlog-qa-123");
    await user.click(screen.getByRole("checkbox", { name: "显示预算摘要" }));
    await user.click(screen.getByRole("button", { name: "创建链接" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole("heading", { name: "分享链接已创建" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("链接只显示一次")).toBeInTheDocument();
    expect(within(dialog).getByText("访问密码")).toBeInTheDocument();
    expect(within(dialog).getByText("含预算")).toBeInTheDocument();
    expect(
      within(dialog).getByText("链接只会显示这一次。关闭后无法再次查看，只能重新创建链接。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("链接相当于访问凭证。不要公开转发；撤销后旧链接会立即失效。"),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/TOKEN|PASSWORD|BUDGET|令牌/);
  });
});
