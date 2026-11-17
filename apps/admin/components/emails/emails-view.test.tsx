import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_EMAILS } from "../../lib/ops-fixtures";
import { EmailsView } from "./emails-view";

describe("EmailsView", () => {
  it("allows support to resend a delivered or bounced email into the queue", async () => {
    const user = userEvent.setup();
    render(<EmailsView role="support" emails={MOCK_ADMIN_EMAILS} />);

    const bouncedRow = screen.getByRole("row", { name: /jiang.yu@example.invalid/ });
    await user.click(
      within(bouncedRow).getByRole("button", {
        name: "重发邮件至 jiang.yu@example.invalid",
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("已重新加入队列");
    expect(within(bouncedRow).getByText("Queued")).toBeInTheDocument();
  });

  it("keeps resend disabled for analysts", () => {
    render(<EmailsView role="analyst" emails={MOCK_ADMIN_EMAILS} />);

    const row = screen.getByRole("row", { name: /jiang.yu@example.invalid/ });
    expect(
      within(row).getByRole("button", { name: "重发邮件至 jiang.yu@example.invalid" }),
    ).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });
});
