import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAdminPostLoginPath } from "../../lib/admin-paths";
import { LoginPanel } from "./login-panel";
import type { AdminAuthTransport } from "../../lib/admin-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LoginPanel", () => {
  it("renders a disabled POST form before client hydration", () => {
    const html = renderToStaticMarkup(<LoginPanel />);
    const document = new DOMParser().parseFromString(html, "text/html");
    const form = document.querySelector("form");

    expect(form?.getAttribute("method")).toBe("post");
    expect(
      (document.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.disabled,
    ).toBe(true);
  });

  it("does not prefill a fixture email by default", () => {
    render(<LoginPanel />);

    expect(screen.getByLabelText(/管理员邮箱/)).toHaveValue("");
    expect(screen.queryByText(/DEMO/)).not.toBeInTheDocument();
  });

  it("only prefills a labelled demo email when NEXT_PUBLIC_ADMIN_DEMO=1", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_DEMO", "1");

    render(<LoginPanel />);

    expect(screen.getByLabelText(/管理员邮箱/)).toHaveValue("demo@roamlog.local");
    expect(screen.getByText("演示模式")).toBeInTheDocument();
    expect(screen.getByText("演示模式：已填入示例账号，请勿用于生产。")).toBeInTheDocument();
    // The env var name is a build-time detail; it must not reach the screen.
    expect(screen.queryByText(/NEXT_PUBLIC_ADMIN_DEMO/)).not.toBeInTheDocument();
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

    render(<LoginPanel transport={transport} onAuthenticated={onAuthenticated} />);

    await user.type(screen.getByLabelText(/管理员邮箱/), "ops@roamlog.test");
    await user.type(screen.getByLabelText(/^密码/), "real-password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(transport.signIn).toHaveBeenCalledWith({
      email: "ops@roamlog.test",
      password: "real-password",
    });
    expect(screen.getByRole("heading", { name: "两步验证" })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/6 位验证码/), "654321");
    await user.click(screen.getByRole("button", { name: "验证并进入控制台" }));

    expect(transport.verifyTotp).toHaveBeenCalledWith("654321");
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("returns to an admin path from a sanitized returnTo only", () => {
    expect(getAdminPostLoginPath("/admin/audit")).toBe("/admin/audit");
    expect(getAdminPostLoginPath("//evil.example/admin")).toBe("/admin");
    expect(getAdminPostLoginPath("https://evil.example/admin")).toBe("/admin");
  });
});
