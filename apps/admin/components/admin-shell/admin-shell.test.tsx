import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_SESSION } from "../../lib/fixtures";
import { AdminShell } from "./admin-shell";

describe("AdminShell", () => {
  it("renders grouped platform navigation, environment, identity, and two-factor state", () => {
    render(
      <AdminShell activePath="/admin/users" session={DEFAULT_ADMIN_SESSION}>
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

    expect(screen.getAllByText("LOCAL")).not.toHaveLength(0);
    expect(screen.getByText("2FA 已启用")).toBeInTheDocument();
    expect(screen.getAllByText(DEFAULT_ADMIN_SESSION.name)).not.toHaveLength(0);
    expect(screen.getByText("support")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "用户列表" })).toBeInTheDocument();
  });

  it("opens global search with the keyboard shortcut and keeps navigation results actionable", async () => {
    const user = userEvent.setup();
    render(
      <AdminShell activePath="/admin" session={DEFAULT_ADMIN_SESSION}>
        <p>总览内容</p>
      </AdminShell>,
    );

    await user.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog", { name: "全局搜索" });
    expect(within(dialog).getByPlaceholderText("搜索页面、用户或工作区…")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /用户/ })).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });
});
