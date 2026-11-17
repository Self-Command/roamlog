import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginPanel } from "./login-panel";
import type { AdminAuthTransport } from "../../lib/admin-auth";

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

  it("uses Better Auth twoFactorRedirect and verifies the TOTP challenge in API mode", async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    const transport: AdminAuthTransport = {
      signIn: vi.fn().mockResolvedValue({
        status: 200,
        data: { twoFactorRedirect: true },
      }),
      verifyTotp: vi.fn().mockResolvedValue({ status: 200, data: { status: true } }),
      enableTotp: vi.fn(),
    };

    render(<LoginPanel mode="api" transport={transport} onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText(/^密码/), "real-password");
    await user.click(screen.getByRole("button", { name: "继续验证" }));

    expect(transport.signIn).toHaveBeenCalledWith({
      email: "lin.zhixia@roamlog.local",
      password: "real-password",
    });
    expect(screen.getByRole("heading", { name: "双因素认证" })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/6 位验证码/), "654321");
    await user.click(screen.getByRole("button", { name: "进入控制台" }));

    expect(transport.verifyTotp).toHaveBeenCalledWith("654321");
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });
});
