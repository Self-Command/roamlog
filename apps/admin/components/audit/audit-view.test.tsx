import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AuditLog } from "@roamlog/contracts";

import { MOCK_ADMIN_USERS, MOCK_AUDIT_LOGS } from "../../lib/fixtures";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import { AuditView } from "./audit-view";

const API_ACTOR_ALPHA = "0199a0c1-1100-7000-8000-0000000000aa";
const API_ACTOR_BETA = "0199a0c1-1100-7000-8000-0000000000bb";

const API_AUDIT_ENTRIES: readonly AuditLog[] = [
  {
    id: "0199a0c3-1300-7000-8000-0000000000a1",
    actorId: API_ACTOR_BETA,
    actorType: "admin",
    action: "admin.flags.update",
    targetType: "feature_flag",
    targetId: "0199a0c3-1300-7000-8000-000000000099",
    workspaceId: null,
    ip: "10.10.2.18",
    userAgent: "Roamlog Admin / api",
    metadata: { key: "share-password-v1", enabled: true },
    createdAt: "2026-11-19T07:46:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-0000000000a2",
    actorId: API_ACTOR_ALPHA,
    actorType: "user",
    action: "admin.user.suspend",
    targetType: "user",
    targetId: "0199a0c3-1300-7000-8000-000000000098",
    workspaceId: null,
    ip: "10.10.2.14",
    userAgent: "Roamlog Admin / api",
    metadata: { reason: "reported abuse" },
    createdAt: "2026-11-19T07:32:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-0000000000a3",
    actorId: API_ACTOR_ALPHA,
    actorType: "admin",
    action: "admin.email.resend",
    targetType: "email_log",
    targetId: "0199a0c3-1300-7000-8000-000000000097",
    workspaceId: null,
    ip: "10.10.2.11",
    userAgent: "Roamlog Admin / api",
    metadata: { template: "workspace-invitation" },
    createdAt: "2026-11-19T07:14:00.000Z",
  },
  {
    id: "0199a0c3-1300-7000-8000-0000000000a4",
    actorId: null,
    actorType: "system",
    action: "system.media.process",
    targetType: "media",
    targetId: "0199a0c3-1300-7000-8000-000000000096",
    workspaceId: null,
    ip: null,
    userAgent: null,
    metadata: { status: "ready" },
    createdAt: "2026-11-19T07:05:00.000Z",
  },
];

function actorOptions(): HTMLOptionElement[] {
  return [...screen.getByLabelText<HTMLSelectElement>("Actor").options];
}

function actorOptionLabels(): string[] {
  return actorOptions().map((option) => option.textContent ?? "");
}

function actorOptionValues(): string[] {
  return actorOptions().map((option) => option.value);
}

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

  it("derives the actor filter from loaded API audit entries, not fixture users", () => {
    render(<AuditView role="analyst" entries={API_AUDIT_ENTRIES} mode="api" />);

    expect(actorOptionLabels()).toEqual([
      "全部操作者",
      "System worker",
      "actor 000000aa",
      "actor 000000bb",
    ]);
    expect(actorOptionValues()).toEqual(["all", "system", API_ACTOR_ALPHA, API_ACTOR_BETA]);
    expect(screen.queryByText("林知夏")).not.toBeInTheDocument();
    expect(screen.queryByText("陈墨")).not.toBeInTheDocument();
  });

  it("offers only the generic actor options when API mode has no loaded entries", () => {
    render(<AuditView role="analyst" entries={[]} mode="api" />);

    expect(actorOptionLabels()).toEqual(["全部操作者", "System worker"]);
    expect(actorOptionValues()).toEqual(["all", "system"]);
    expect(screen.queryByText("林知夏")).not.toBeInTheDocument();
  });

  it("keeps fixture admin users in the actor filter in fixture mode", () => {
    render(<AuditView role="analyst" entries={MOCK_AUDIT_LOGS} />);

    const select = screen.getByLabelText<HTMLSelectElement>("Actor");
    expect(actorOptionLabels()).toEqual([
      "全部操作者",
      "System worker",
      ...MOCK_ADMIN_USERS.map((user) => user.name),
    ]);
    expect(within(select).getByRole("option", { name: "林知夏" })).toBeInTheDocument();
  });

  it("keeps a selected API actor filter visible after the loaded page changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AuditView role="analyst" entries={API_AUDIT_ENTRIES} mode="api" />,
    );

    const select = screen.getByLabelText<HTMLSelectElement>("Actor");
    await user.selectOptions(select, API_ACTOR_ALPHA);
    expect(select.value).toBe(API_ACTOR_ALPHA);

    rerender(<AuditView role="analyst" entries={[]} mode="api" />);

    expect(actorOptionValues()).toEqual(["all", "system", API_ACTOR_ALPHA]);
    expect(actorOptionLabels()).toEqual(["全部操作者", "System worker", "actor 000000aa"]);
    expect(screen.getByLabelText<HTMLSelectElement>("Actor").value).toBe(API_ACTOR_ALPHA);
  });
});
