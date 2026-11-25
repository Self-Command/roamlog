import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminWorkspaceDetail, AdminWorkspaceListItem } from "@roamlog/contracts";

import type { AdminMutationPort } from "../../lib/admin-data-source";
import { sampleUsers } from "../../test/admin-sample-data";
import { WorkspacesView } from "./workspaces-view";

/**
 * The view derives capability from the role, so a delete-only operator cannot be
 * expressed with a real platform role once transfer has its own action. Override
 * `canPlatform` for the decoupling assertions only; everything else delegates to
 * the real compiled matrix.
 */
const permissionOverrides = vi.hoisted(() => new Map<string, boolean>());

vi.mock("@roamlog/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@roamlog/contracts")>();
  return {
    ...actual,
    canPlatform: (role: string, action: string) =>
      permissionOverrides.get(action) ?? actual.canPlatform(role, action),
  };
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const owner = sampleUsers[1]!;
const editor = sampleUsers[5]!;
const workspaceId = "0199a0c2-1200-7000-8000-000000000001";

function listWorkspace(_index = 0): AdminWorkspaceListItem {
  return {
    id: workspaceId,
    name: "Roamlog Crew",
    slug: "roamlog-crew",
    logoMediaId: null,
    ownerId: owner.id,
    plan: "team",
    status: "active",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: {},
    createdAt: "2026-06-09T02:00:00.000Z",
    updatedAt: "2026-11-17T07:41:00.000Z",
    deletedAt: null,
    owner: { id: owner.id, name: owner.name, email: owner.email, image: null },
    memberCount: 8,
    tripCount: 9,
    entryCount: 42,
    mediaCount: 4,
    mediaBytes: 1048576,
  };
}

function detailWorkspace(): AdminWorkspaceDetail {
  const row = listWorkspace();
  return {
    ...row,
    memberCount: row.memberCount ?? 0,
    tripCount: row.tripCount ?? 0,
    entryCount: row.entryCount ?? 0,
    owner: { id: owner.id, name: owner.name, email: owner.email, image: null },
    mediaBytes: 1048576,
    mediaCount: 4,
    members: [
      {
        userId: owner.id,
        name: owner.name,
        email: owner.email,
        image: null,
        role: "owner",
        status: "active",
        joinedAt: "2026-06-09T02:00:00.000Z",
      },
      {
        userId: editor.id,
        name: editor.name,
        email: editor.email,
        image: null,
        role: "editor",
        status: "active",
        joinedAt: "2026-09-14T04:30:00.000Z",
      },
    ],
    invitations: [
      {
        id: "0199a0c5-1500-7000-8000-000000000001",
        workspaceId,
        email: "invitee@roamlog.test",
        role: "viewer",
        invitedById: owner.id,
        expiresAt: "2026-12-01T00:00:00.000Z",
        acceptedAt: null,
        revokedAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
  };
}

function stubWorkspacePages(rows = [listWorkspace()]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/admin/workspaces/")) {
        return jsonResponse(detailWorkspace());
      }
      return jsonResponse({ items: rows, nextCursor: null, hasMore: false });
    }),
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  permissionOverrides.clear();
});

describe("WorkspacesView", () => {
  it("requires the workspace name before suspension can be confirmed", async () => {
    const user = userEvent.setup();
    stubWorkspacePages();
    renderWithClient(<WorkspacesView role="support" />);

    const firstRow = await screen.findByRole("row", { name: /Roamlog Crew/ });
    expect(within(firstRow).getByRole("button", { name: "移入已删除" })).toBeDisabled();
    await user.click(within(firstRow).getByRole("button", { name: "暂停工作区" }));

    const dialog = screen.getByRole("dialog", { name: "暂停工作区" });
    const confirm = within(dialog).getByRole("button", { name: "确认暂停" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("输入工作区名称确认"), "Roamlog Crew");
    await user.click(confirm);

    // Without a mutation port the console refuses the write instead of faking it.
    expect(screen.getByRole("status")).toHaveTextContent("后台服务未连接");
  });

  it("keeps workspace destructive actions disabled for analysts", async () => {
    stubWorkspacePages();
    renderWithClient(<WorkspacesView role="analyst" />);

    const firstRow = await screen.findByRole("row", { name: /Roamlog Crew/ });
    expect(within(firstRow).getByRole("button", { name: "暂停工作区" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "移入已删除" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("renders real list metrics and owner data from the server response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ items: [listWorkspace()], nextCursor: null, hasMore: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWithClient(<WorkspacesView role="admin" />);

    const row = await screen.findByRole("row", { name: /Roamlog Crew/ });
    expect(within(row).getByText(owner.name)).toBeInTheDocument();
    expect(within(row).getByText(owner.email)).toBeInTheDocument();
    expect(within(row).getByText("8")).toBeInTheDocument();
    expect(within(row).getByText("9")).toBeInTheDocument();
    expect(within(row).getByText("42")).toBeInTheDocument();
    expect(within(row).getByText("1 MB")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=25");
  });

  it("loads members, invitation status and storage from the workspace detail endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/admin/workspaces/")) {
        return jsonResponse(detailWorkspace());
      }
      if (url.includes("/v1/admin/trips")) {
        return jsonResponse({ items: [], nextCursor: null, hasMore: false });
      }
      return jsonResponse({ items: [listWorkspace()], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(<WorkspacesView role="admin" />);
    const row = await screen.findByRole("row", { name: /Roamlog Crew/ });
    await user.click(within(row).getByRole("button", { name: "工作区详情" }));

    expect(await screen.findByText(editor.name)).toBeInTheDocument();
    expect(screen.getByText("编辑者")).toBeInTheDocument();
    expect(screen.getByText("invitee@roamlog.test")).toBeInTheDocument();
    expect(screen.getByText("待处理")).toBeInTheDocument();
    expect(screen.getAllByText("1 MB").length).toBeGreaterThan(1);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes(`/v1/admin/workspaces/${workspaceId}`)),
    ).toBe(true);
  });

  it("submits a real plan change with confirmation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/admin/workspaces/")) {
        return jsonResponse(detailWorkspace());
      }
      if (url.includes("/v1/admin/trips")) {
        return jsonResponse({ items: [], nextCursor: null, hasMore: false });
      }
      return jsonResponse({ items: [listWorkspace()], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const updateWorkspace = vi.fn().mockResolvedValue(undefined);
    const mutations = { updateWorkspace } as unknown as AdminMutationPort;
    const user = userEvent.setup();

    renderWithClient(
      <WorkspacesView role="admin" mutations={mutations} />,
    );
    const row = await screen.findByRole("row", { name: /Roamlog Crew/ });
    await user.click(within(row).getByRole("button", { name: "工作区详情" }));
    await screen.findByText(editor.name);
    await user.click(screen.getByRole("button", { name: "变更套餐" }));

    const dialog = screen.getByRole("dialog", { name: "变更套餐" });
    await user.selectOptions(within(dialog).getByLabelText("新套餐"), "pro");
    await user.type(within(dialog).getByLabelText("输入工作区名称确认"), "Roamlog Crew");
    await user.click(within(dialog).getByRole("button", { name: "确认变更" }));

    await waitFor(() => {
      expect(updateWorkspace).toHaveBeenCalledWith(workspaceId, { plan: "pro" });
    });
  });

  it("transfers ownership to an active member through PATCH", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/admin/workspaces/")) {
        return jsonResponse(detailWorkspace());
      }
      if (url.includes("/v1/admin/trips")) {
        return jsonResponse({ items: [], nextCursor: null, hasMore: false });
      }
      return jsonResponse({ items: [listWorkspace()], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const updateWorkspace = vi.fn().mockResolvedValue(undefined);
    const mutations = { updateWorkspace } as unknown as AdminMutationPort;
    const user = userEvent.setup();

    renderWithClient(
      <WorkspacesView role="admin" mutations={mutations} />,
    );
    const row = await screen.findByRole("row", { name: /Roamlog Crew/ });
    await user.click(within(row).getByRole("button", { name: "工作区详情" }));
    await screen.findByText(editor.name);
    await user.click(screen.getByRole("button", { name: "转移所有权" }));

    const dialog = screen.getByRole("dialog", { name: "转移所有权" });
    expect(within(dialog).getByLabelText("新所有者")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("输入工作区名称确认"), "Roamlog Crew");
    await user.click(within(dialog).getByRole("button", { name: "确认转移" }));

    await waitFor(() => {
      expect(updateWorkspace).toHaveBeenCalledWith(workspaceId, { ownerId: editor.id });
    });
  });

  it("disables ownership transfer for an operator that only has delete", async () => {
    stubWorkspacePages();
    permissionOverrides.set("admin:workspaces:delete", true);
    permissionOverrides.set("admin:workspaces:transfer", false);
    const user = userEvent.setup();

    renderWithClient(<WorkspacesView role="admin" />);
    const row = await screen.findByRole("row", { name: /Roamlog Crew/ });
    await user.click(within(row).getByRole("button", { name: "工作区详情" }));
    await screen.findByText(editor.name);

    expect(screen.getByRole("button", { name: "转移所有权" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "变更套餐" })).toBeEnabled();
  });

  it("enables ownership transfer with transfer even when delete is missing", async () => {
    stubWorkspacePages();
    permissionOverrides.set("admin:workspaces:delete", false);
    permissionOverrides.set("admin:workspaces:transfer", true);
    const user = userEvent.setup();

    renderWithClient(<WorkspacesView role="admin" />);
    const row = await screen.findByRole("row", { name: /Roamlog Crew/ });
    await user.click(within(row).getByRole("button", { name: "工作区详情" }));
    await screen.findByText(editor.name);

    expect(screen.getByRole("button", { name: "转移所有权" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "变更套餐" })).toBeDisabled();
  });

  it("exports with active filters and has no disabled export placeholder", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ items: [listWorkspace()], nextCursor: null, hasMore: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const exportCsv = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithClient(
      <WorkspacesView role="admin" exportCsv={exportCsv} />,
    );
    await screen.findByRole("row", { name: /Roamlog Crew/ });

    const exportButton = screen.getByRole("button", { name: /导出 CSV/ });
    expect(exportButton).toBeEnabled();
    expect(screen.queryByText(/导出接口将在运营 Wave 接入/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("搜索工作区"), "crew");
    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("q=crew")),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    await user.click(exportButton);

    await waitFor(() => {
      expect(exportCsv).toHaveBeenCalledWith(
        expect.objectContaining({ q: "crew", sort: "createdAt:desc", limit: 25 }),
      );
    });
  });

  it("renders the API error state instead of an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            type: "https://roamlog.app/errors/forbidden",
            title: "Forbidden",
            status: 403,
            detail: "Your platform role does not permit this Admin action.",
            code: "ADMIN_ACTION_FORBIDDEN",
          },
          403,
        ),
      ),
    );

    renderWithClient(<WorkspacesView role="admin" />);

    expect(await screen.findByText("加载失败，请稍后重试")).toBeInTheDocument();
    expect(screen.getByText(/ADMIN_ACTION_FORBIDDEN/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
