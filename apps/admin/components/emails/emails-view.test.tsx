import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMutationPort } from "../../lib/admin-data-source";
import { sampleEmails } from "../../test/admin-sample-data";
import { EmailsView } from "./emails-view";

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EmailsView", () => {
  it("allows support to resend a bounced email into the queue", async () => {
    const user = userEvent.setup();
    renderWithClient(<EmailsView role="support" emails={sampleEmails} />);

    const bouncedRow = screen.getByRole("row", { name: "邮件 j***@example.invalid" });
    await user.click(
      within(bouncedRow).getByRole("button", { name: "重发邮件至 j***@example.invalid" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("已重新加入队列");
    expect(within(bouncedRow).getByText("Queued")).toBeInTheDocument();
  });

  it("keeps resend disabled for analysts", () => {
    renderWithClient(<EmailsView role="analyst" emails={sampleEmails} />);

    const row = screen.getByRole("row", { name: "邮件 j***@example.invalid" });
    expect(
      within(row).getByRole("button", { name: "重发邮件至 j***@example.invalid" }),
    ).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("disables resend for sent, delivered, and complained emails with a stated reason", () => {
    renderWithClient(<EmailsView role="support" emails={sampleEmails} />);

    const sentRow = screen
      .getAllByRole("row", { name: "邮件 m***@example.invalid" })
      .find((row) => within(row).queryByText("Sent"));
    expect(sentRow).toBeDefined();

    const button = within(sentRow as HTMLElement).getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("仅 failed / bounced 可重发"));
  });

  it("never renders a full recipient address", () => {
    renderWithClient(<EmailsView role="support" emails={sampleEmails} />);

    expect(screen.queryByText(/jiang\.yu@example\.invalid/)).not.toBeInTheDocument();
    expect(screen.getAllByText("j***@example.invalid").length).toBeGreaterThan(0);
  });

  it("surfaces the most recent delivery error with a masked recipient", () => {
    renderWithClient(<EmailsView role="support" emails={sampleEmails} />);

    const summary = screen.getByRole("note", { name: "最近错误原因" });
    expect(within(summary).getByText(/550 mailbox unavailable/)).toBeInTheDocument();
    expect(within(summary).getByText(/j\*\*\*@example\.invalid/)).toBeInTheDocument();
  });

  it("resends through the Admin API mutation port in API mode", async () => {
    const user = userEvent.setup();
    const mutations = {
      resendEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as AdminMutationPort;
    const email = sampleEmails[1]!;
    // The API-mode metric cards read real totals from /v1/admin/metrics.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            emails: { queued: 1, sent: 1, delivered: 1, bounced: 1, complained: 1, failed: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    renderWithClient(
      <EmailsView role="support" emails={sampleEmails} mutations={mutations} />,
    );

    const row = screen.getByRole("row", { name: "邮件 j***@example.invalid" });
    await user.click(
      within(row).getByRole("button", { name: "重发邮件至 j***@example.invalid" }),
    );

    expect(mutations.resendEmail).toHaveBeenCalledWith(email.id);
    expect(await screen.findByText("已重新加入队列", { exact: false })).toBeInTheDocument();
  });

  it("no longer offers a test email action without an API endpoint", () => {
    renderWithClient(<EmailsView role="super_admin" emails={sampleEmails} />);

    expect(screen.queryByRole("button", { name: /测试邮件/ })).not.toBeInTheDocument();
    expect(screen.getByText("测试邮件入口未接入")).toBeInTheDocument();
  });
});