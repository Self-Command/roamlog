import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AdminAuthTransport } from "../../lib/admin-auth";
import { TwoFactorEnrollmentPanel } from "./two-factor-enrollment";

describe("TwoFactorEnrollmentPanel", () => {
  it("renders a disabled POST form before hydration", () => {
    const html = renderToStaticMarkup(<TwoFactorEnrollmentPanel />);
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(document.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });

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

    render(<TwoFactorEnrollmentPanel transport={transport} onComplete={onComplete} />);

    await user.type(screen.getByLabelText(/当前密码/), "correct-password");
    await user.click(screen.getByRole("button", { name: "开始绑定验证器" }));

    expect(screen.getByRole("img", { name: "验证器二维码" })).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp\/Roamlog:admin@roamlog.local/)).toBeInTheDocument();
    expect(screen.getByText("8F3K-2M9Q")).toBeInTheDocument();
    expect(screen.getByText("A7D1-6X4P")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/验证器 6 位验证码/), "123456");
    await user.click(screen.getByRole("button", { name: "完成两步验证" }));

    expect(transport.verifyTotp).toHaveBeenCalledWith("123456");
    expect(onComplete).toHaveBeenCalledOnce();
  });

});
