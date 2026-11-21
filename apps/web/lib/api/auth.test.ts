import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHANGE_EMAIL_NOT_CONFIGURED_MESSAGE,
  MAIL_NOT_CONFIGURED_MESSAGE,
  accountSecurityErrorMessage,
  authErrorMessage,
  enableTwoFactor,
  twoFactorErrorMessage,
} from "./auth";
import { ApiError } from "./errors";

const IMPLEMENTATION_TERMS = /TOTP|2FA|挑战|认证服务|会话|API|HTTP/i;

function expectUserFacingCopy(message: string): void {
  expect(message.trim().length).toBeGreaterThan(0);
  expect(message).not.toMatch(IMPLEMENTATION_TERMS);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("twoFactorErrorMessage", () => {
  it.each([
    [401, "INVALID_CODE", "验证码不正确或已过期"],
    [401, "INVALID_TWO_FACTOR_COOKIE", "本次登录验证已过期"],
    [403, "FORBIDDEN", "没有权限"],
    [429, "ACCOUNT_TEMPORARILY_LOCKED", "两步验证已临时锁定"],
    [500, "INTERNAL_SERVER_ERROR", "登录服务暂时不可用"],
  ])("maps %i/%s to user-facing copy", (status, code, expected) => {
    const message = twoFactorErrorMessage(new ApiError(status, "Technical failure", code));

    expect(message).toContain(expected);
    expectUserFacingCopy(message);
  });

  it("removes challenge vocabulary when attempts are exhausted", () => {
    const message = twoFactorErrorMessage(
      new ApiError(400, "Too many attempts", "TOO_MANY_ATTEMPTS"),
    );

    expect(message).toContain("本次登录验证");
    expectUserFacingCopy(message);
  });

  it("describes a missing authenticator key without naming the protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "{}",
      }),
    );

    const error = await enableTwoFactor("correct-password").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("验证器密钥");
    expectUserFacingCopy(message);
    expect(twoFactorErrorMessage(error)).toBe(message);
  });
});

describe("authErrorMessage", () => {
  it.each([
    [401, "UNAUTHORIZED", "邮箱或密码不正确"],
    [403, "FORBIDDEN", "没有权限"],
    [429, "TOO_MANY_REQUESTS", "尝试次数过多"],
  ])("maps %i/%s to user-facing copy", (status, code, expected) => {
    const message = authErrorMessage(new ApiError(status, "Technical failure", code));

    expect(message).toContain(expected);
    expectUserFacingCopy(message);
  });

  it("passes through a user-readable 500 message", () => {
    const message = authErrorMessage(
      new ApiError(500, "登录服务暂时不可用，请稍后再试。", "INTERNAL_SERVER_ERROR"),
    );

    expect(message).toBe("登录服务暂时不可用，请稍后再试。");
    expectUserFacingCopy(message);
  });

  it("uses the mail transport copy instead of the operator message", () => {
    const message = authErrorMessage(
      new ApiError(400, "Set the mail provider in Admin settings", "MAIL_NOT_CONFIGURED"),
    );

    expect(message).toBe(MAIL_NOT_CONFIGURED_MESSAGE);
    expectUserFacingCopy(message);
  });
});

describe("accountSecurityErrorMessage", () => {
  it.each([
    [401, "UNAUTHORIZED", "password", "当前登录状态已失效"],
    [403, "FORBIDDEN", "email", "没有权限"],
    [429, "TOO_MANY_REQUESTS", "password", "尝试次数过多"],
    [500, "INTERNAL_SERVER_ERROR", "email", "登录服务暂时不可用"],
  ] as const)("maps %i/%s to user-facing copy", (status, code, action, expected) => {
    const message = accountSecurityErrorMessage(
      new ApiError(status, "Technical failure", code),
      action,
    );

    expect(message).toContain(expected);
    expectUserFacingCopy(message);
  });

  it.each(["SESSION_NOT_FRESH", "SESSION_EXPIRED"])(
    "describes an expired login for %s without session vocabulary",
    (code) => {
      const message = accountSecurityErrorMessage(
        new ApiError(401, "Technical failure", code),
        "password",
      );

      expect(message).toContain("本次登录已超过安全时效");
      expectUserFacingCopy(message);
    },
  );

  it("describes disabled email changes without deployment vocabulary", () => {
    const message = accountSecurityErrorMessage(
      new ApiError(400, "CHANGE_EMAIL_DISABLED", "CHANGE_EMAIL_DISABLED"),
      "email",
    );

    expect(message).toContain("没有开启邮箱修改");
    expect(message).not.toMatch(/部署|认证配置/);
    expectUserFacingCopy(message);
  });
});

describe("mail delivery copy", () => {
  it("is readable without implementation terms", () => {
    expectUserFacingCopy(MAIL_NOT_CONFIGURED_MESSAGE);
    expectUserFacingCopy(CHANGE_EMAIL_NOT_CONFIGURED_MESSAGE);
  });
});
