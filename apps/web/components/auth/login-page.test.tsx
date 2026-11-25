import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return { ...actual, getPublicSettings: vi.fn() };
});

import LoginPage from "@/app/(auth)/login/page";
import { getPublicSettings } from "@/lib/settings";

const mockedSettings = vi.mocked(getPublicSettings);

const FALLBACK_TAGLINE = "登录后进入你的旅行总览，行程与日志会留在同一个工作区。";

const IMPLEMENTATION_DETAILS =
  /Better Auth|httpOnly|cookie|localStorage|HTTP|\bAPI\b|后端|服务端|数据库|TOTP|\b2FA\b|认证服务|客户端会话|前端存储/i;

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

  it("does not expose authentication implementation details in the login copy", async () => {
    mockedSettings.mockResolvedValue({});

    const { container } = render(await LoginPage());

    expect(container.textContent).not.toMatch(IMPLEMENTATION_DETAILS);
    expect(screen.getByText(FALLBACK_TAGLINE)).toBeInTheDocument();
    expect(screen.getByText("安全登录")).toBeInTheDocument();
  });
});
