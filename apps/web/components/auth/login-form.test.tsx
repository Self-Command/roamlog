import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LoginFormView } from "./login-form";

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

  it("confirms local validation without pretending to authenticate", async () => {
    const user = userEvent.setup();
    render(<LoginFormView />);

    await user.type(screen.getByLabelText("邮箱"), "lin.mo@roamlog.local");
    await user.type(screen.getByLabelText("密码"), "roamlog-demo");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "表单校验通过。真实认证将在身份后端接入后启用。",
    );
  });
});
