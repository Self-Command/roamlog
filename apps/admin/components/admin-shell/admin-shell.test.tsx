import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdminLoginPathWithReturnTo,
  getAdminPostLoginPath,
} from "../../lib/admin-paths";
import { ADMIN_NAV_GROUPS } from "./admin-nav";
import { AdminShell } from "./admin-shell";

const { useGetMeMock, redirectToAdminLoginMock } = vi.hoisted(() => ({
  useGetMeMock: vi.fn(),
  redirectToAdminLoginMock: vi.fn(),
}));

vi.mock("@roamlog/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@roamlog/api-client")>();
  return {
    ...actual,
    useGetMe: (...args: unknown[]) => useGetMeMock(...args),
  };
});

vi.mock("./admin-navigation", () => ({
  redirectToAdminLogin: redirectToAdminLoginMock,
}));

const ADMIN_USER = {
  id: "0199a0c0-1000-7000-8000-000000000001",
  name: "Ops Admin",
  email: "ops@roamlog.test",
  emailVerified: true,
  image: null,
  platformRole: "admin",
  status: "active",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  lastActiveAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

function authenticatedSession(overrides: Record<string, unknown> = {}) {
  return {
    data: { status: 200, data: { ...ADMIN_USER, ...overrides } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function unauthenticatedSession() {
  return {
    data: { status: 401, data: {} },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

const SUPPORT_SESSION = {
  name: "林知夏",
  email: "lin.zhixia@roamlog.test",
  platformRole: "support",
};

beforeEach(() => {
  useGetMeMock.mockReset();
  useGetMeMock.mockReturnValue(authenticatedSession(SUPPORT_SESSION));
  redirectToAdminLoginMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const ADMIN_APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../app/admin");

const NAV_ITEMS = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

/** A nav href only leads somewhere if the App Router page file behind it exists. */
function hasPageFile(href: string): boolean {
  const segment = href.replace(/^\/admin\/?/, "");
  return existsSync(join(ADMIN_APP_DIR, segment, "page.tsx"));
}

describe("AdminShell", () => {
  it("links the moderation queue and never ships a nav entry without a page", () => {
    const hrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

    // B4_MODERATION rebuilt the real report queue and restored the nav entry.
    // The old assertion here checked for its absence, which after that work
    // asserted that working software was missing.
    expect(hrefs).toContain("/admin/content");
    expect(NAV_ITEMS.find((item) => item.href === "/admin/content")?.label).toBe("内容审核");
    expect(existsSync(join(ADMIN_APP_DIR, "content", "page.tsx"))).toBe(true);

    // The original intent, kept and widened: every nav item must resolve to a
    // page. This still catches "nav has an entry but the page is gone", which is
    // the dead link the old directory blacklist was trying to prevent.
    const deadLinks = hrefs.filter((href) => !hasPageFile(href));
    expect(deadLinks).toEqual([]);
  });

  it("renders the moderation entry as a real link", () => {
    render(
      <AdminShell activePath="/admin/content">
        <h1>内容审核</h1>
      </AdminShell>,
    );

    expect(screen.getByRole("link", { name: "内容审核" })).toHaveAttribute(
      "href",
      "/admin/content",
    );
  });

  it("renders navigation and identity without fabricated environment, 2FA or notification badges", () => {
    render(
      <AdminShell activePath="/admin/users">
        <h1>用户列表</h1>
      </AdminShell>,
    );

    expect(screen.getByRole("navigation", { name: "管理后台主导航" })).toBeInTheDocument();
    expect(screen.getByText("平台概览")).toBeInTheDocument();
    expect(screen.getByText("信任与安全")).toBeInTheDocument();
    expect(screen.getByText("数据与运营")).toBeInTheDocument();

    const usersLink = screen.getByRole("link", { name: "用户" });
    expect(usersLink).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "总览" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "工作区" })).toHaveAttribute(
      "href",
      "/admin/workspaces",
    );
    expect(screen.getByRole("link", { name: "审计日志" })).toHaveAttribute("href", "/admin/audit");

    // The old shell hard-coded LOCAL and 2FA badges from fixture fields.
    const header = screen.getByRole("banner");
    const sidebar = screen.getByRole("complementary", { name: "管理后台侧栏" });
    expect(within(header).queryByText(/2FA/i)).not.toBeInTheDocument();
    expect(within(sidebar).queryByText(/2FA/)).not.toBeInTheDocument();
    expect(within(sidebar).queryByText("LOCAL")).not.toBeInTheDocument();
    expect(within(header).queryByText("LOCAL")).not.toBeInTheDocument();
    expect(screen.queryByText("LOCAL")).not.toBeInTheDocument();
    expect(screen.queryByText("Environment")).not.toBeInTheDocument();

    // Notifications had no API source, so the bell and unread badge are gone.
    expect(screen.queryByRole("button", { name: /通知/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/条未读/)).not.toBeInTheDocument();

    expect(screen.getAllByText(SUPPORT_SESSION.name)).not.toHaveLength(0);
    expect(screen.getAllByText("support").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "用户列表" })).toBeInTheDocument();
  });

  it("derives the environment badge from explicit configuration only", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");

    render(
      <AdminShell activePath="/admin">
        <p>总览内容</p>
      </AdminShell>,
    );

    expect(screen.getAllByText("STAGING").length).toBeGreaterThan(0);
    expect(screen.queryByText("LOCAL")).not.toBeInTheDocument();
  });

  it("renders the real API session without 2FA or notification affordances", () => {
    useGetMeMock.mockReturnValue(authenticatedSession());

    render(
      <AdminShell activePath="/admin/users">
        <h1>用户列表</h1>
      </AdminShell>,
    );

    expect(screen.getAllByText("Ops Admin")).not.toHaveLength(0);
    expect(screen.getAllByText("ops@roamlog.test")).not.toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: /平台角色/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
    const header = screen.getByRole("banner");
    const sidebar = screen.getByRole("complementary", { name: "管理后台侧栏" });
    expect(within(header).queryByText(/2FA/i)).not.toBeInTheDocument();
    expect(within(sidebar).queryByText(/2FA/)).not.toBeInTheDocument();
    expect(within(sidebar).queryByText("LOCAL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /通知/ })).not.toBeInTheDocument();
    expect(screen.queryByText("LOCAL")).not.toBeInTheDocument();
  });

  it("redirects an unauthenticated API session to login with the current path as returnTo", async () => {
    useGetMeMock.mockReturnValue(unauthenticatedSession());
    window.history.replaceState({}, "", "/admin/users?status=active");

    render(
      <AdminShell activePath="/admin/users">
        <h1>用户列表</h1>
      </AdminShell>,
    );

    await waitFor(() => {
      expect(redirectToAdminLoginMock).toHaveBeenCalledWith("/admin/users?status=active");
    });
    expect(getAdminLoginPathWithReturnTo("/admin/users?status=active")).toBe(
      "/login?returnTo=%2Fadmin%2Fusers%3Fstatus%3Dactive",
    );
    expect(screen.getByRole("heading", { name: "会话已过期" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "继续前往登录" })).toHaveAttribute(
        "href",
        "/login?returnTo=%2Fadmin%2Fusers%3Fstatus%3Dactive",
      );
    });
  });

  it("calls the real sign-out endpoint and leaves the console on success", async () => {
    const user = userEvent.setup();
    useGetMeMock.mockReturnValue(authenticatedSession());
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AdminShell activePath="/admin/users">
        <h1>用户列表</h1>
      </AdminShell>,
    );

    await user.click(screen.getByRole("button", { name: /退出登录/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/v1/auth/sign-out",
        expect.objectContaining({ method: "POST", credentials: "include" }),
      );
    });
    expect(redirectToAdminLoginMock).toHaveBeenCalled();
  });

  it("shows the sign-out error and keeps the session when the API rejects it", async () => {
    const user = userEvent.setup();
    useGetMeMock.mockReturnValue(authenticatedSession());
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AdminShell activePath="/admin/users">
        <h1>用户列表</h1>
      </AdminShell>,
    );

    await user.click(screen.getByRole("button", { name: /退出登录/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("退出登录失败（HTTP 500）");
    expect(alert).toHaveTextContent("当前会话仍然有效");
    expect(redirectToAdminLoginMock).not.toHaveBeenCalled();
    // The console still shows the authenticated identity because the cookie was kept.
    expect(screen.getByText("ops@roamlog.test")).toBeInTheDocument();
  });

  it("opens global search with the keyboard shortcut and keeps navigation results actionable", async () => {
    const user = userEvent.setup();
    render(
      <AdminShell activePath="/admin">
        <p>总览内容</p>
      </AdminShell>,
    );

    await user.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog", { name: "全局搜索" });
    expect(within(dialog).getByPlaceholderText("搜索后台页面…")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /用户/ })).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });

  it("builds login and post-login paths with a sanitized returnTo", () => {
    expect(getAdminLoginPathWithReturnTo()).toBe("/login");
    expect(getAdminLoginPathWithReturnTo("/admin/users")).toBe("/login?returnTo=%2Fadmin%2Fusers");
    expect(getAdminLoginPathWithReturnTo("//evil.example/admin")).toBe("/login");
    expect(getAdminLoginPathWithReturnTo("https://evil.example/admin")).toBe("/login");
    expect(getAdminPostLoginPath("/admin/users")).toBe("/admin/users");
    expect(getAdminPostLoginPath("//evil.example/admin")).toBe("/admin");
    expect(getAdminPostLoginPath(null)).toBe("/admin");

    vi.stubEnv("NEXT_PUBLIC_ADMIN_LOGIN_PATH", "/admin/login");
    expect(getAdminLoginPathWithReturnTo("/admin")).toBe(
      "/admin/login?returnTo=%2Fadmin",
    );
  });
});
