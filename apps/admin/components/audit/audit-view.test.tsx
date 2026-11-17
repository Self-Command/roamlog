import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MOCK_AUDIT_LOGS } from "../../lib/fixtures";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { AuditView } from "./audit-view";

describe("AuditView", () => {
  it("renders the append-only timeline and governance actions", () => {
    render(<AuditView role="analyst" entries={MOCK_AUDIT_LOGS} />);

    expect(screen.getByRole("heading", { name: "审计日志" })).toBeInTheDocument();
    expect(screen.getByText("admin.user.suspend")).toBeInTheDocument();
    expect(screen.getByText("system.media.process")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("does not expose audit export to support", () => {
    render(<AuditView role="support" entries={MOCK_AUDIT_LOGS} />);

    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeDisabled();
    expect(screen.getByText("仅 Analyst 及以上角色可导出审计 CSV。")).toBeInTheDocument();
  });

  it("surfaces locally recorded mock actions for cross-route verification", async () => {
    recordMockAuditEvent({
      action: "mock.local.verification",
      targetType: "user",
      targetId: "mock-target",
      targetName: "林知夏",
    });

    render(<AuditView role="admin" entries={MOCK_AUDIT_LOGS} />);

    expect(screen.getByText("最近本地模拟操作")).toBeInTheDocument();
    expect(await screen.findByText("mock.local.verification")).toBeInTheDocument();
  });

  it("exports the current filters through the Admin API in API mode", async () => {
    const user = userEvent.setup();
    const exportCsv = vi.fn().mockResolvedValue("\uFEFFid,action\r\n");
    const createObjectURL = vi.fn(() => "blob:roamlog-audit");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<AuditView role="analyst" entries={MOCK_AUDIT_LOGS} mode="api" exportCsv={exportCsv} />);

    await user.click(screen.getByRole("button", { name: "导出 CSV" }));

    expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ sort: "createdAt:desc" }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(await screen.findByText("已从 Admin API 导出审计 CSV。")).toBeInTheDocument();
    click.mockRestore();
  });
});
