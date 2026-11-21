import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { twoFactorErrorMessage, type TwoFactorAuthTransport } from "@/lib/api/auth";
import { LoginFormView } from "./login-form";

const IMPLEMENTATION_DETAILS =
  /Workspace|Better Auth|httpOnly|cookie|localStorage|HTTP|\bAPI\b|后端|服务端|数据库|TOTP|\b2FA\b|认证服务|客户端会话|前端存储/i;

function transport(overrides: Partial<TwoFactorAuthTransport> = {}): TwoFactorAuthTransport {
  return {
    signIn: vi.fn().mockResolvedValue({
      twoFactorRedirect: false,
      twoFactorMethods: ["totp"],
    }),
    verifyTotp: vi.fn().mockResolvedValue(undefined),
    verifyBackupCode: vi.fn().mockResolvedValue(undefined),
    getSecuritySession: vi.fn().mockResolvedValue({
      authenticated: true,
      twoFactorEnabled: true,
    }),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
    generateBackupCodes: vi.fn(),
    ...overrides,
  };
}

describe("LoginFormView", () => {
  it("associates required and format errors with the login fields", async () => {
    const user = userEvent.setup();
    render(<LoginFormView />);

    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByText("请输入邮箱地址")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();

    const email = screen.getByLabelText("邮箱");
    const password = screen.getByLabelText("密码");
    await user.type(email, "not-an-email");
    await user.type(password, "short");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByText("请输入有效的邮箱地址")).toBeInTheDocument();
    expect(screen.getByText("密码至少需要 8 位")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");
  });

  it("submits valid credentials to the auth transport", async () => {
    const user = userEvent.setup();
    const auth = transport();
    const onAuthenticated = vi.fn();
    render(<LoginFormView auth={auth} onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText("邮箱"), "lin.mo@roamlog.local");
    await user.type(screen.getByLabelText("密码"), "roamlog-demo");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(auth.signIn).toHaveBeenCalledWith("lin.mo@roamlog.local", "roamlog-demo");
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("does not expose authentication implementation details on the credential step", () => {
    const { container } = render(<LoginFormView />);

    expect(container.textContent).not.toMatch(IMPLEMENTATION_DETAILS);
    expect(screen.getByText("安全登录")).toBeInTheDocument();
  });

  it("moves from credentials to the TOTP challenge when Better Auth redirects", async () => {
    const user = userEvent.setup();
    const auth = transport({
      signIn: vi.fn().mockResolvedValue({
        twoFactorRedirect: true,
        twoFactorMethods: ["totp"],
      }),
    });
    const onAuthenticated = vi.fn();

    const { container } = render(
      <LoginFormView auth={auth} onAuthenticated={onAuthenticated} />,
    );

    await user.type(screen.getByLabelText("邮箱"), "lin.mo@roamlog.local");
    await user.type(screen.getByLabelText("密码"), "roamlog-demo");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("heading", { name: "再确认一次是你" })).toBeInTheDocument();
    expect(screen.getByText("lin.mo@roamlog.local")).toBeInTheDocument();
    expect(auth.signIn).toHaveBeenCalledWith("lin.mo@roamlog.local", "roamlog-demo");
    expect(screen.getByText("SECURITY CHECK")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "选择验证方式" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(IMPLEMENTATION_DETAILS);

    await user.type(screen.getByLabelText(/验证器 6 位验证码/), "123456");
    await user.click(screen.getByRole("button", { name: "完成验证" }));

    expect(auth.verifyTotp).toHaveBeenCalledWith("123456");
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("maps an invalid TOTP to a retry and lockout warning", async () => {
    const user = userEvent.setup();
    const auth = transport({
      signIn: vi.fn().mockResolvedValue({
        twoFactorRedirect: true,
        twoFactorMethods: ["totp"],
      }),
      verifyTotp: vi.fn().mockRejectedValue(new ApiError(401, "Invalid code", "INVALID_CODE")),
    });
    const onAuthenticated = vi.fn();

    render(<LoginFormView auth={auth} onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText("邮箱"), "lin.mo@roamlog.local");
    await user.type(screen.getByLabelText("密码"), "roamlog-demo");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.type(screen.getByLabelText(/验证器 6 位验证码/), "000000");
    await user.click(screen.getByRole("button", { name: "完成验证" }));

    expect(screen.getByRole("alert")).toHaveTextContent("验证码不正确或已过期");
    expect(screen.getByRole("alert")).toHaveTextContent("本次验证已失败 1 次");
    expect(screen.getByRole("alert").textContent).not.toMatch(IMPLEMENTATION_DETAILS);
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("completes a challenge with a one-time backup code", async () => {
    const user = userEvent.setup();
    const auth = transport({
      signIn: vi.fn().mockResolvedValue({
        twoFactorRedirect: true,
        twoFactorMethods: ["totp"],
      }),
    });
    const onAuthenticated = vi.fn();

    render(<LoginFormView auth={auth} onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText("邮箱"), "lin.mo@roamlog.local");
    await user.type(screen.getByLabelText("密码"), "roamlog-demo");
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(screen.getByRole("button", { name: "备用码" }));
    await user.type(screen.getByLabelText(/一次性备用码/), "abcde-12345");
    await user.click(screen.getByRole("button", { name: "完成验证" }));

    expect(auth.verifyBackupCode).toHaveBeenCalledWith("abcde-12345");
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });
});

describe("twoFactorErrorMessage", () => {
  it("maps 401, 403 and 429 failures to actionable security copy", () => {
    expect(twoFactorErrorMessage(new ApiError(401, "Invalid code", "INVALID_CODE"))).toContain(
      "验证码不正确或已过期",
    );
    expect(twoFactorErrorMessage(new ApiError(403, "Forbidden", "FORBIDDEN"))).toContain(
      "没有权限",
    );
    expect(
      twoFactorErrorMessage(new ApiError(429, "Locked", "ACCOUNT_TEMPORARILY_LOCKED")),
    ).toContain("临时锁定");
  });
});
