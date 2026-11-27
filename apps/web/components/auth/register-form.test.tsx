import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegisterForm } from "./register-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RegisterForm", () => {
  it("renders a disabled POST form before hydration", () => {
    const html = renderToStaticMarkup(<RegisterForm />);
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(document.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("describes the next step without internal workspace terminology", () => {
    const { container } = render(<RegisterForm />);

    expect(
      screen.getByText("注册后会发送验证邮件。完成邮箱验证后，即可创建工作区或接受邀请。"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Workspace/);
  });

  it("does not claim success when the account is created but verification mail fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            token: null,
            user: { id: "user-1", email: "new@roamlog.test" },
            emailDelivery: "failed",
          }),
      }),
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText("名字"), "New User");
    await user.type(screen.getByLabelText("邮箱"), "new@roamlog.test");
    await user.type(screen.getByLabelText("密码"), "Roamlog-Prod-Aa1!");
    await user.click(screen.getByRole("button", { name: /创建账号/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("账号已创建，但验证邮件没有发出");
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
