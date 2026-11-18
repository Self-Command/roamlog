import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminMutationPort } from "../../lib/admin-data-source";
import { MOCK_ADMIN_WORKSPACES } from "../../lib/fixtures";
import { MOCK_ADMIN_FLAGS } from "../../lib/ops-fixtures";
import { FlagsView } from "./flags-view";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FlagsView", () => {
  it("saves a rollout percentage change and emits a mock audit event", async () => {
    const user = userEvent.setup();
    render(
      <FlagsView role="super_admin" flags={MOCK_ADMIN_FLAGS} workspaces={MOCK_ADMIN_WORKSPACES} />,
    );

    const flagRow = screen.getByRole("article", { name: /share-password-v1/ });
    const slider = within(flagRow).getByLabelText("share-password-v1 灰度比例");
    fireEvent.change(slider, { target: { value: "40" } });
    expect(within(flagRow).getByText("40%")).toBeInTheDocument();

    await user.click(within(flagRow).getByRole("button", { name: "保存配置" }));

    expect(screen.getByRole("status")).toHaveTextContent("已保存 share-password-v1");
    expect(within(flagRow).getByText("40%")).toBeInTheDocument();
  });

  it("keeps flag configuration read-only for analysts", () => {
    render(
      <FlagsView role="analyst" flags={MOCK_ADMIN_FLAGS} workspaces={MOCK_ADMIN_WORKSPACES} />,
    );

    const flagRow = screen.getByRole("article", { name: /share-password-v1/ });
    expect(within(flagRow).getByRole("button", { name: "保存配置" })).toBeDisabled();
    expect(within(flagRow).getByRole("switch", { name: "share-password-v1 启用" })).toBeDisabled();
    expect(within(flagRow).getByRole("button", { name: "删除开关 share-password-v1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "新建功能开关" })).toBeDisabled();
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });

  it("shows an empty state with a create call to action", () => {
    render(<FlagsView role="super_admin" flags={[]} workspaces={MOCK_ADMIN_WORKSPACES} />);

    expect(screen.getByText("还没有功能开关")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建功能开关" })).toBeEnabled();
  });

  it("creates a flag with key, description, rollout, and allowlist", async () => {
    const user = userEvent.setup();
    render(<FlagsView role="super_admin" flags={[]} workspaces={MOCK_ADMIN_WORKSPACES} />);

    await user.click(screen.getByRole("button", { name: "新建功能开关" }));
    const dialog = screen.getByRole("dialog", { name: "新建功能开关" });
    await user.type(within(dialog).getByLabelText(/开关 key/), "share.password.v2");
    await user.type(within(dialog).getByLabelText(/^描述/), "分享密码 v2");
    fireEvent.change(within(dialog).getByLabelText("灰度比例（0-100）"), {
      target: { value: "20" },
    });
    await user.click(within(dialog).getByRole("button", { name: "创建开关" }));

    expect(screen.getByRole("status")).toHaveTextContent("已创建 share.password.v2");
    expect(screen.getByRole("article", { name: "功能开关 share.password.v2" })).toBeInTheDocument();
  });

  it("rejects duplicate keys and invalid rollout values before any request", async () => {
    const user = userEvent.setup();
    render(
      <FlagsView role="super_admin" flags={MOCK_ADMIN_FLAGS} workspaces={MOCK_ADMIN_WORKSPACES} />,
    );

    await user.click(screen.getByRole("button", { name: "新建功能开关" }));
    const dialog = screen.getByRole("dialog", { name: "新建功能开关" });
    const keyInput = within(dialog).getByLabelText(/开关 key/);
    await user.type(keyInput, "share-password-v1");
    await user.type(within(dialog).getByLabelText(/^描述/), "duplicate");
    await user.click(within(dialog).getByRole("button", { name: "创建开关" }));

    expect(within(dialog).getByText(/key 已存在/)).toBeInTheDocument();

    await user.clear(keyInput);
    await user.type(keyInput, "Bad Key!");
    await user.click(within(dialog).getByRole("button", { name: "创建开关" }));
    expect(within(dialog).getByText(/只能使用小写字母/)).toBeInTheDocument();
  });

  it("creates through the Admin mutation port in API mode", async () => {
    const user = userEvent.setup();
    const mutations = {
      createFlag: vi.fn().mockResolvedValue(undefined),
    } as unknown as AdminMutationPort;
    render(
      <FlagsView
        role="super_admin"
        flags={[]}
        workspaces={MOCK_ADMIN_WORKSPACES}
        mode="api"
        mutations={mutations}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建功能开关" }));
    const dialog = screen.getByRole("dialog", { name: "新建功能开关" });
    await user.type(within(dialog).getByLabelText(/开关 key/), "api.created.flag");
    await user.type(within(dialog).getByLabelText(/^描述/), "created via API");
    await user.click(within(dialog).getByRole("button", { name: "创建开关" }));

    expect(mutations.createFlag).toHaveBeenCalledWith({
      key: "api.created.flag",
      description: "created via API",
      enabled: false,
      rolloutPercentage: 0,
      workspaceAllowlist: [],
    });
  });

  it("deletes a flag after typing its key", async () => {
    const user = userEvent.setup();
    render(
      <FlagsView role="super_admin" flags={MOCK_ADMIN_FLAGS} workspaces={MOCK_ADMIN_WORKSPACES} />,
    );

    await user.click(screen.getByRole("button", { name: "删除开关 map-style-dark-v2" }));
    const dialog = screen.getByRole("dialog", { name: "删除功能开关" });
    const confirm = within(dialog).getByRole("button", { name: "确认删除" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("输入开关 key 确认"), "map-style-dark-v2");
    await user.click(confirm);

    expect(screen.queryByRole("article", { name: /map-style-dark-v2/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已删除 map-style-dark-v2");
  });

  it("warns about unsaved edits and blocks in-app navigation", async () => {
    const user = userEvent.setup();
    render(
      <FlagsView role="super_admin" flags={MOCK_ADMIN_FLAGS} workspaces={MOCK_ADMIN_WORKSPACES} />,
    );

    const flagRow = screen.getByRole("article", { name: /share-password-v1/ });
    fireEvent.change(within(flagRow).getByLabelText("share-password-v1 灰度比例"), {
      target: { value: "45" },
    });

    expect(screen.getByText(/有 1 个开关存在未保存的修改/)).toBeInTheDocument();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = document.createElement("a");
    link.href = "/admin/users";
    link.textContent = "用户";
    document.body.append(link);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    link.remove();

    await user.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(screen.queryByText(/存在未保存的修改/)).not.toBeInTheDocument();
  });
});