import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdminMutationPort } from "../../lib/admin-data-source";
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

  it("resends through the Admin API mutation port in API mode", async () => {
    const user = userEvent.setup();
    const mutations = {
      resendEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as AdminMutationPort;
    const email = MOCK_ADMIN_EMAILS[1]!;
    render(
      <EmailsView role="support" emails={MOCK_ADMIN_EMAILS} mode="api" mutations={mutations} />,
    );

    const row = screen.getByRole("row", { name: new RegExp(email.to) });
    await user.click(within(row).getByRole("button", { name: `重发邮件至 ${email.to}` }));

    expect(mutations.resendEmail).toHaveBeenCalledWith(email.id);
    expect(await screen.findByText("已重新加入队列", { exact: false })).toBeInTheDocument();
  });
});
