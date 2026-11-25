import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_ACTION_DESCRIPTIONS,
  ADMIN_ACTIONS,
  PLATFORM_ROLE_ACTIONS,
  PLATFORM_ROLES,
  type AdminPermissionsResponse,
} from "@roamlog/contracts";

import { PermissionsView } from "./permissions-view";

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

const MATRIX: AdminPermissionsResponse = {
  roles: PLATFORM_ROLES.map((role) => ({
    role,
    actions: [...PLATFORM_ROLE_ACTIONS[role]],
  })),
  actions: ADMIN_ACTIONS.map((action) => ({
    action,
    description: ADMIN_ACTION_DESCRIPTIONS[action],
    grantable:
      action !== "admin:users:delete" &&
      action !== "admin:users:change-role" &&
      action !== "admin:users:reset-2fa" &&
      action !== "admin:users:update" &&
      action !== "admin:settings:write" &&
      action !== "admin:permissions:read" &&
      action !== "admin:permissions:write",
  })),
};

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PermissionsView", () => {
  it("renders the merged matrix and locks security-sensitive cells", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(MATRIX)),
    );
    renderWithClient(<PermissionsView role="super_admin" />);

    expect(await screen.findByRole("table", { name: "平台角色与管理员动作权限矩阵" })).toBeInTheDocument();
    expect(screen.getByText("admin:users:delete")).toBeInTheDocument();
    expect(screen.getByText("admin:users:update")).toBeInTheDocument();
    // One lock per role for each non-grantable action.
    const locks = screen.getAllByLabelText(/安全敏感，界面不可授予/);
    const nonGrantable = MATRIX.actions.filter((action) => !action.grantable).length;
    expect(locks).toHaveLength(nonGrantable * MATRIX.roles.length);

    const grantable = screen.getByRole("checkbox", { name: "支持人员 · admin:flags:update" });
    expect(grantable).toBeEnabled();
    expect(screen.queryByRole("checkbox", { name: "支持人员 · admin:users:delete" })).toBeNull();
  });

  it("requires a second confirmation and re-reads the matrix after saving", async () => {
    const events = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ ...MATRIX });
      }
      return jsonResponse(MATRIX);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(<PermissionsView role="super_admin" />);

    const checkbox = await screen.findByRole("checkbox", {
      name: "支持人员 · admin:flags:update",
    });
    await events.click(checkbox);
    expect(screen.getByText("1 项待保存")).toBeInTheDocument();

    await events.click(screen.getByRole("button", { name: "保存变更" }));
    const dialog = await screen.findByRole("dialog", { name: "保存权限矩阵变更" });
    expect(within(dialog).getByText(/授予 · 支持人员 · admin:flags:update/)).toBeInTheDocument();

    // Nothing is written before the explicit confirmation.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

    await events.click(within(dialog).getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        changes: [{ role: "support", action: "admin:flags:update", granted: true }],
      });
    });
    expect(await screen.findByText(/已保存 1 项变更/)).toBeInTheDocument();

    const gets = fetchMock.mock.calls.filter(([, init]) => init?.method !== "PATCH");
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it("cancels a save without writing", async () => {
    const events = userEvent.setup();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(MATRIX),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(<PermissionsView role="super_admin" />);

    await events.click(
      await screen.findByRole("checkbox", { name: "支持人员 · admin:flags:update" }),
    );
    await events.click(screen.getByRole("button", { name: "保存变更" }));
    const dialog = await screen.findByRole("dialog", { name: "保存权限矩阵变更" });
    await events.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    expect(screen.getByText("1 项待保存")).toBeInTheDocument();
  });

  it("keeps every cell visible but read-only for a non-super_admin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(MATRIX)),
    );
    renderWithClient(<PermissionsView role="analyst" />);

    const checkbox = await screen.findByRole("checkbox", {
      name: "支持人员 · admin:flags:update",
    });
    expect(checkbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存变更" })).toBeDisabled();
    expect(screen.getByText("只有超级管理员可以修改权限矩阵。")).toBeInTheDocument();
  });
});
