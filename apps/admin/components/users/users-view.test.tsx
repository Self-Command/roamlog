import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminUserDetail } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminMutationPort } from "../../lib/admin-data-source";
import { MOCK_ADMIN_USERS } from "../../lib/fixtures";
import { UsersView } from "./users-view";

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

const fixture = MOCK_ADMIN_USERS[0]!;

function listUser(index = 0) {
  const user = MOCK_ADMIN_USERS[index] ?? fixture;
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    image: user.image,
    platformRole: user.platformRole,
    status: user.status,
    locale: user.locale,
    timezone: user.timezone,
    lastActiveAt: user.lastActiveAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
    activeSessionCount: 2,
  };
}

function detailUser(): AdminUserDetail {
  return {
    ...listUser(0),
    workspaceCount: 2,
    tripCount: 7,
    entryCount: 24,
    activeSessionCount: 2,
    twoFactorEnabled: true,
    commentCount: 5,
    mediaCount: 3,
    workspaces: [
      {
        workspaceId: "0199a0c2-1200-7000-8000-000000000001",
        workspaceName: "Roamlog Crew",
        workspaceSlug: "roamlog-crew",
        role: "owner",
        status: "active",
        joinedAt: "2026-06-09T02:00:00.000Z",
      },
    ],
    sessions: [
      {
        id: "0199a0c4-1400-7000-8000-000000000001",
        ipAddress: "10.0.0.1",
        userAgent: "Chrome on macOS",
        createdAt: "2026-11-17T07:50:00.000Z",
        expiresAt: "2026-12-17T07:50:00.000Z",
      },
    ],
  };
}

function setMode(mode: "api" | "fixture") {
  process.env.NEXT_PUBLIC_ADMIN_DATA_MODE = mode;
}

beforeEach(() => {
  setMode("fixture");
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_ADMIN_DATA_MODE;
});

describe("UsersView", () => {
  it("requires typing the target name before a destructive action can be confirmed", async () => {
    const user = userEvent.setup();
    renderWithClient(<UsersView role="support" users={MOCK_ADMIN_USERS} />);

    const firstRow = screen.getByRole("row", { name: /林知夏/ });
    expect(within(firstRow).getByRole("button", { name: "修改平台角色" })).toBeDisabled();
    await user.click(within(firstRow).getByRole("button", { name: "暂停账户" }));

    const dialog = screen.getByRole("dialog", { name: "暂停账户" });
    const confirm = within(dialog).getByRole("button", { name: "确认暂停" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("输入用户姓名确认"), "林知夏");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(screen.queryByRole("dialog", { name: "暂停账户" })).not.toBeInTheDocument();
    expect(within(firstRow).getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("模拟审计事件已记录");
  });

  it("keeps every destructive user action visible but disabled for analysts", () => {
    renderWithClient(<UsersView role="analyst" users={MOCK_ADMIN_USERS} />);

    const firstRow = screen.getByRole("row", { name: /林知夏/ });
    expect(within(firstRow).getByRole("button", { name: "暂停账户" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "修改平台角色" })).toBeDisabled();
    expect(within(firstRow).getByRole("button", { name: "删除用户" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("allows support to suspend but not change platform roles", async () => {
    const user = userEvent.setup();
    renderWithClient(<UsersView role="support" users={MOCK_ADMIN_USERS} />);

    const firstRow = screen.getByRole("row", { name: /林知夏/ });
    const suspend = within(firstRow).getByRole("button", { name: "暂停账户" });
    expect(suspend).toBeEnabled();
    expect(within(firstRow).getByRole("button", { name: "修改平台角色" })).toBeDisabled();

    await user.click(suspend);
    expect(screen.getByRole("dialog", { name: "暂停账户" })).toBeInTheDocument();
  });

  it("paginates with server cursors and sends the search term to the API", async () => {
    setMode("api");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=next-1")) {
        return jsonResponse({ items: [listUser(2)], nextCursor: null, hasMore: false });
      }
      return jsonResponse({ items: [listUser(0), listUser(1)], nextCursor: "next-1", hasMore: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(<UsersView role="admin" mode="api" users={[]} />);

    await screen.findByRole("row", { name: /林知夏/ });
    await screen.findByRole("row", { name: /陈墨/ });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/v1/admin/users");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=25");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("row", { name: /周遥/ });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("cursor=next-1")),
    ).toBe(true);

    await user.type(screen.getByLabelText("搜索用户"), "Chen");
    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("q=Chen")),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it("restores server filters from session storage after a remount", async () => {
    setMode("api");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ items: [listUser(0)], nextCursor: null, hasMore: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const first = renderWithClient(<UsersView role="admin" mode="api" users={[]} />);
    await screen.findByRole("row", { name: /林知夏/ });
    await user.type(screen.getByLabelText("搜索用户"), "lin");
    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("q=lin")),
        ).toBe(true);
      },
      { timeout: 2000 },
    );

    first.unmount();
    fetchMock.mockClear();
    renderWithClient(<UsersView role="admin" mode="api" users={[]} />);

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("q=lin")),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(screen.getByLabelText("搜索用户")).toHaveValue("lin");
  });

  it("loads detail counters, memberships, sessions and 2FA from GET /admin/users/:id", async () => {
    setMode("api");
    const detail = detailUser();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/admin/users/")) {
        return jsonResponse(detail);
      }
      return jsonResponse({ items: [listUser(0)], nextCursor: null, hasMore: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(<UsersView role="admin" mode="api" users={[]} />);
    const firstRow = await screen.findByRole("row", { name: /林知夏/ });
    await user.click(within(firstRow).getByRole("button", { name: "详情" }));

    expect(await screen.findByText("Roamlog Crew")).toBeInTheDocument();
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeInTheDocument();
    expect(screen.getByText("评论")).toBeInTheDocument();
    expect(screen.getByText("媒体")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(`/v1/admin/users/${fixture.id}`),
      ),
    ).toBe(true);
  });

  it("shows the API error on a failed mutation and closes the dialog", async () => {
    setMode("api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ items: [listUser(0)], nextCursor: null, hasMore: false })),
    );
    const mutations = {
      updateUser: vi.fn().mockRejectedValue(
        new AdminMutationError({
          code: "ADMIN_ACTION_FORBIDDEN",
          status: 403,
          title: "Forbidden",
          detail: "Your platform role does not permit this Admin action.",
          degraded: [],
        }),
      ),
    } as unknown as AdminMutationPort;
    const user = userEvent.setup();

    renderWithClient(
      <UsersView role="admin" mode="api" users={[]} mutations={mutations} />,
    );
    const firstRow = await screen.findByRole("row", { name: /林知夏/ });
    await user.click(within(firstRow).getByRole("button", { name: "暂停账户" }));

    const dialog = screen.getByRole("dialog", { name: "暂停账户" });
    await user.type(within(dialog).getByLabelText("输入用户姓名确认"), "林知夏");
    await user.click(within(dialog).getByRole("button", { name: "确认暂停" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("ADMIN_ACTION_FORBIDDEN");
    });
    expect(screen.queryByRole("dialog", { name: "暂停账户" })).not.toBeInTheDocument();
  });

  it("exports with the active server filters and never renders the old disabled placeholder", async () => {
    setMode("api");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ items: [listUser(0)], nextCursor: null, hasMore: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const exportCsv = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithClient(
      <UsersView role="admin" mode="api" users={[]} exportCsv={exportCsv} />,
    );
    await screen.findByRole("row", { name: /林知夏/ });

    const exportButton = screen.getByRole("button", { name: /导出 CSV/ });
    expect(exportButton).toBeEnabled();
    expect(screen.queryByText(/导出接口将在运营 Wave 接入/)).not.toBeInTheDocument();
    expect(exportButton).not.toHaveAttribute("title", "未接入");

    await user.type(screen.getByLabelText("搜索用户"), "lin");
    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("q=lin")),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
    await user.click(exportButton);

    await waitFor(() => {
      expect(exportCsv).toHaveBeenCalledWith(
        expect.objectContaining({ q: "lin", sort: "createdAt:desc", limit: 25 }),
      );
    });
  });

  it("renders the API error state instead of an empty dead table", async () => {
    setMode("api");
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

    renderWithClient(<UsersView role="admin" mode="api" users={[]} />);

    expect(await screen.findByText("ADMIN_ACTION_FORBIDDEN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});