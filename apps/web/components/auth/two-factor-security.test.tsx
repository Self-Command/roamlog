import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TwoFactorAuthTransport } from "@/lib/api/auth";
import { TwoFactorSecurityView } from "./two-factor-security";

function transport(overrides: Partial<TwoFactorAuthTransport> = {}): TwoFactorAuthTransport {
  return {
    signIn: vi.fn(),
    verifyTotp: vi.fn().mockResolvedValue(undefined),
    verifyBackupCode: vi.fn(),
    getSecuritySession: vi.fn().mockResolvedValue({
      authenticated: true,
      email: "lin.mo@roamlog.local",
      twoFactorEnabled: false,
    }),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn().mockResolvedValue(undefined),
    generateBackupCodes: vi.fn(),
    ...overrides,
  };
}

const enrollment = {
  totpURI: "otpauth://totp/Roamlog:lin.mo%40roamlog.local?secret=JBSWY3DPEHPK3PXP&issuer=Roamlog",
  backupCodes: ["8F3K-2M9Q", "A7D1-6X4P"],
};

describe("TwoFactorSecurityView", () => {
  it("renders local QR, secret and backup codes, then verifies enrollment", async () => {
    const user = userEvent.setup();
    const auth = transport({
      enableTwoFactor: vi.fn().mockResolvedValue(enrollment),
    });

    render(
      <TwoFactorSecurityView
        mode="api"
        auth={auth}
        initialSession={{
          authenticated: true,
          email: "lin.mo@roamlog.local",
          twoFactorEnabled: false,
        }}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "启用两步验证" }));
    await user.type(screen.getByLabelText(/当前密码/), "correct-password");
    await user.click(screen.getByRole("button", { name: "生成 TOTP 密钥" }));

    expect(auth.enableTwoFactor).toHaveBeenCalledWith("correct-password");
    expect(screen.getByRole("img", { name: "TOTP 二维码" })).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByText("8F3K-2M9Q")).toBeInTheDocument();
    expect(screen.getByText("A7D1-6X4P")).toBeInTheDocument();
    expect(screen.getByText(/当前剩余 2 个/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/验证器验证码/), "123456");
    await user.click(screen.getByRole("button", { name: "验证并启用 2FA" }));

    expect(auth.verifyTotp).toHaveBeenCalledWith("123456");
    expect(screen.getByText("两步验证已启用。请确认备用码已离线保存。")).toBeInTheDocument();
    expect(screen.getByText("已启用并验证")).toBeInTheDocument();
  });

  it("disables 2FA only after verifying the password and current TOTP code", async () => {
    const user = userEvent.setup();
    const auth = transport();

    render(
      <TwoFactorSecurityView
        mode="api"
        auth={auth}
        initialSession={{
          authenticated: true,
          email: "lin.mo@roamlog.local",
          twoFactorEnabled: true,
        }}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "关闭两步验证" }));
    await user.type(screen.getByLabelText(/当前密码/), "correct-password");
    await user.type(screen.getByLabelText(/验证器 6 位验证码/), "654321");
    await user.click(screen.getByRole("button", { name: "确认关闭 2FA" }));

    expect(auth.verifyTotp).toHaveBeenCalledWith("654321");
    expect(auth.disableTwoFactor).toHaveBeenCalledWith("correct-password");
    expect(screen.getByRole("status")).toHaveTextContent("两步验证已关闭");
    expect(screen.getByRole("switch", { name: "启用两步验证" })).not.toBeChecked();
  });

  it("regenerates backup codes and labels the new set as one-time", async () => {
    const user = userEvent.setup();
    const auth = transport({
      generateBackupCodes: vi.fn().mockResolvedValue(["NEW01-ABCDE", "NEW02-FGHIJ"]),
    });

    render(
      <TwoFactorSecurityView
        mode="api"
        auth={auth}
        initialSession={{
          authenticated: true,
          email: "lin.mo@roamlog.local",
          twoFactorEnabled: true,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "重新生成备用码" }));
    await user.type(screen.getByLabelText(/当前密码/), "correct-password");
    await user.click(screen.getByRole("button", { name: "替换备用码" }));

    expect(auth.generateBackupCodes).toHaveBeenCalledWith("correct-password");
    expect(screen.getByText("NEW01-ABCDE")).toBeInTheDocument();
    expect(screen.getByText("NEW02-FGHIJ")).toBeInTheDocument();
    expect(screen.getAllByText(/每个码只能成功使用一次/).length).toBeGreaterThan(0);
  });

  it("keeps mock mode explicit and never claims a real enrollment", () => {
    const auth = transport();
    render(<TwoFactorSecurityView mode="mock" auth={auth} />);

    expect(screen.getByRole("heading", { name: "演示模式不注册真实 TOTP" })).toBeInTheDocument();
    expect(screen.getByText("NO REAL ENROLLMENT")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "演示模式不可切换两步验证" })).toBeDisabled();
    expect(auth.enableTwoFactor).not.toHaveBeenCalled();
    expect(auth.getSecuritySession).not.toHaveBeenCalled();
  });
});
