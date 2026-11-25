import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RegisterForm } from "./register-form";

describe("RegisterForm", () => {
  it("describes the next step without internal workspace terminology", () => {
    const { container } = render(<RegisterForm />);

    expect(
      screen.getByText("注册后会发送验证邮件。完成邮箱验证后，即可创建工作区或接受邀请。"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Workspace/);
  });
});
