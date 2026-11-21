import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InviteAccept } from "./invite-accept";

const adapter = vi.hoisted(() => ({ acceptInvitation: vi.fn() }));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => adapter,
}));

const IMPLEMENTATION_DETAILS = /Workspace|token|服务端|9\s*趟旅行/i;

describe("InviteAccept", () => {
  it("uses product copy without implementation details or invented trip counts", () => {
    const { container } = render(
      <InviteAccept
        workspaceName="京都慢行小队"
        inviterName="林默"
        role="editor"
        token="invite-credential"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "加入「京都慢行小队」" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("旅行、共享日志和照片会出现在同一个工作区。"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(IMPLEMENTATION_DETAILS);
  });
});
