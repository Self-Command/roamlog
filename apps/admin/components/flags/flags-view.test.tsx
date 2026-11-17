import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MOCK_ADMIN_WORKSPACES } from "../../lib/fixtures";
import { MOCK_ADMIN_FLAGS } from "../../lib/ops-fixtures";
import { FlagsView } from "./flags-view";

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
    expect(screen.getByText("只读分析模式")).toBeInTheDocument();
  });
});
