import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";

/**
 * FORGOT_PASSWORD_FIX — the reset request the UI actually issues, and what the
 * user sees for each answer.
 *
 * `fetch` is stubbed (not the API module) so these tests exercise the real
 * `requestPasswordReset` → `authRequest` path: a wrong endpoint would fail the
 * URL assertion instead of hiding behind a mocked function.
 *
 * Acceptance for the real stack lives in `e2e/web/forgot-password.spec.ts`.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submit(email = "verify@roamlog.test") {
  const user = userEvent.setup();
  render(<ForgotPasswordPage />);
  await user.type(screen.getByLabelText("邮箱"), email);
  await user.click(screen.getByRole("button", { name: /发送重置链接/ }));
}

describe("ForgotPasswordPage", () => {
  it("posts to better-auth's /v1/auth/request-password-reset and reports the link was sent", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: true,
        message: "If this email exists in our system, check your email for the reset link",
      }),
    );

    await submit();

    // The endpoint better-auth 1.7 actually mounts; /forget-password answers 404.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/auth/request-password-reset");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "verify@roamlog.test" });

    await waitFor(() => {
      expect(
        screen.getByText(/如果该邮箱存在，重置链接已发送到收件箱/),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/重置链接已发送到收件箱/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The old placeholder copy admitted nothing was sent; it must stay gone.
    expect(screen.queryByText(/当前为占位状态/)).not.toBeInTheDocument();
  });

  it("shows an honest failure, not success, when the API reports emailDelivery=not_configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: true, emailDelivery: "not_configured" }));

    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("邮件服务未配置");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("请联系管理员");
    // Success state is absence-checked too: only one outcome may render.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/重置链接已发送到收件箱/)).not.toBeInTheDocument();
  });

  it("surfaces a 404 from a wrong endpoint as an error alert instead of claiming success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "Not found", code: "NOT_FOUND" }, 404),
    );

    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Not found/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});