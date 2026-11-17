import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdminAuthTransport } from "../../lib/admin-auth";
import { TwoFactorEnrollmentPanel } from "./two-factor-enrollment";

describe("TwoFactorEnrollmentPanel", () => {
  it("renders totpURI, a local QR, backup codes, and verifies enrollment in API mode", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const transport: AdminAuthTransport = {
      signIn: vi.fn(),
      enableTotp: vi.fn().mockResolvedValue({
        status: 200,
        data: {
          totpURI:
            "otpauth://totp/Roamlog:admin@roamlog.local?secret=JBSWY3DPEHPK3PXP&issuer=Roamlog",
          backupCodes: ["8F3K-2M9Q", "A7D1-6X4P"],
        },
      }),
      verifyTotp: vi.fn().mockResolvedValue({ status: 200, data: { status: true } }),
    };

    render(<TwoFactorEnrollmentPanel mode="api" transport={transport} onComplete={onComplete} />);

    await user.type(screen.getByLabelText(/当前密码/), "correct-password");
    await user.click(screen.getByRole("button", { name: "生成 TOTP 密钥" }));

    expect(screen.getByRole("img", { name: "TOTP 二维码" })).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp\/Roamlog:admin@roamlog.local/)).toBeInTheDocument();
    expect(screen.getByText("8F3K-2M9Q")).toBeInTheDocument();
    expect(screen.getByText("A7D1-6X4P")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/验证器 6 位验证码/), "123456");
    await user.click(screen.getByRole("button", { name: "完成 2FA 验证" }));

    expect(transport.verifyTotp).toHaveBeenCalledWith("123456");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("keeps fixture mode as an explicit demo without network enrollment", () => {
    render(<TwoFactorEnrollmentPanel mode="fixture" />);

    expect(screen.getByRole("heading", { name: "演示模式不注册真实 TOTP" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/当前密码/)).not.toBeInTheDocument();
  });
});
