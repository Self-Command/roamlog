import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginPanel } from "./login-panel";

describe("LoginPanel", () => {
  it("progresses from the placeholder credentials step to the 2FA step", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    render(<LoginPanel onAuthenticated={onAuthenticated} />);

    expect(screen.getByRole("heading", { name: "进入平台控制台" })).toBeInTheDocument();
    const emailInput = screen.getByLabelText(/管理员邮箱/);
    await user.clear(emailInput);
    await user.type(emailInput, "admin@roamlog.local");
    await user.type(screen.getByLabelText(/^密码/), "local-placeholder");
    await user.click(screen.getByRole("button", { name: "继续验证" }));

    expect(screen.getByRole("heading", { name: "双因素认证" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/6 位验证码/), "123456");
    await user.click(screen.getByRole("button", { name: "进入控制台" }));

    expect(onAuthenticated).toHaveBeenCalledOnce();
  });
});
