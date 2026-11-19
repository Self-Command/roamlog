import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return { ...actual, getPublicSettings: vi.fn() };
});

import LoginPage from "@/app/(auth)/login/page";
import { getPublicSettings } from "@/lib/settings";

const mockedSettings = vi.mocked(getPublicSettings);

const FALLBACK_TAGLINE =
  "登录后会进入 Workspace 总览。会话由 Better Auth 的 httpOnly cookie 维护。";

beforeEach(() => {
  mockedSettings.mockReset();
});

describe("LoginPage runtime copy", () => {
  it("renders the configured theme.loginTagline as the login subtitle", async () => {
    mockedSettings.mockResolvedValue({
      "theme.loginTagline": "Pack light, write often.",
    });

    render(await LoginPage());

    expect(screen.getByText("Pack light, write often.")).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK_TAGLINE)).not.toBeInTheDocument();
  });

  it("falls back to the existing copy when the setting is absent", async () => {
    mockedSettings.mockResolvedValue({});

    render(await LoginPage());

    expect(screen.getByText(FALLBACK_TAGLINE)).toBeInTheDocument();
  });

  it("falls back when the configured tagline is blank", async () => {
    mockedSettings.mockResolvedValue({ "theme.loginTagline": "   " });

    render(await LoginPage());

    expect(screen.getByText(FALLBACK_TAGLINE)).toBeInTheDocument();
  });

  it("shows no error copy when the settings read fails", async () => {
    mockedSettings.mockResolvedValue({});

    const { container } = render(await LoginPage());

    expect(container.textContent).not.toMatch(/加载失败|配置错误|服务不可用/);
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });
});