import { RequestPasswordResetResponseSchema, type EmailDeliveryMarker } from "@roamlog/contracts";

import { ApiError, errorFromResponse } from "./errors";

export type TwoFactorMethod = "totp" | "backup-code";

/**
 * The request reached the API but no reset link exists, because the deployment
 * has no usable mail transport. Thrown instead of resolving so the form can show
 * a failure alert: Better Auth's own body is a deliberately generic 200, so this
 * marker is the only signal that nothing was delivered.
 */
export class EmailNotConfiguredError extends Error {
  readonly code = "MAIL_NOT_CONFIGURED" as const;

  constructor(message: string) {
    super(message);
    this.name = "EmailNotConfiguredError";
  }
}

/** A send was attempted and failed: the link never left the building. */
export class EmailDeliveryFailedError extends Error {
  readonly code = "MAIL_DELIVERY_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryFailedError";
  }
}

/** Copy used wherever a mail-dependent action cannot deliver. */
export const MAIL_NOT_CONFIGURED_MESSAGE =
  "邮件服务未配置，暂时无法发送重置链接。请联系管理员配置邮件发送后重试。";

/** Copy for a send that was attempted and failed (transport down or rejected). */
export const MAIL_DELIVERY_FAILED_MESSAGE =
  "邮件未能发出，重置链接没有送达。请稍后重试；若持续失败，请联系管理员检查邮件服务。";

export interface SignInResult {
  twoFactorRedirect: boolean;
  twoFactorMethods: string[];
}

export interface TwoFactorEnrollment {
  totpURI: string;
  backupCodes: string[];
}

export interface SecuritySession {
  authenticated: boolean;
  email?: string;
  name?: string;
  twoFactorEnabled: boolean;
}

async function authRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "Authentication response was not JSON.", "INVALID_JSON");
    }
  }

  if (!response.ok) {
    const container = body as { message?: unknown; code?: unknown } | null;
    const message =
      typeof container?.message === "string"
        ? container.message
        : `Authentication request failed with status ${response.status}.`;
    throw new ApiError(
      response.status,
      message,
      typeof container?.code === "string" ? container.code : "AUTH_REQUEST_FAILED",
    );
  }

  return body;
}

function jsonInit(method: string, input: unknown): RequestInit {
  return { method, body: JSON.stringify(input) };
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const body = await authRequest(
    "/v1/auth/sign-in/email",
    jsonInit("POST", { email, password, rememberMe: true }),
  );
  const container = body as { twoFactorRedirect?: unknown; twoFactorMethods?: unknown } | null;
  return {
    twoFactorRedirect: container?.twoFactorRedirect === true,
    twoFactorMethods: Array.isArray(container?.twoFactorMethods)
      ? container.twoFactorMethods.filter((method): method is string => typeof method === "string")
      : [],
  };
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  await authRequest("/v1/auth/sign-up/email", jsonInit("POST", { name, email, password }));
}

export async function sendVerificationEmail(email: string): Promise<void> {
  await authRequest(
    "/v1/auth/send-verification-email",
    jsonInit("POST", {
      email,
      callbackURL: `${window.location.origin}/login`,
    }),
  );
}

/**
 * Better Auth mounts the reset request at `/request-password-reset`
 * (`createAuthEndpoint("/request-password-reset")`); `/forget-password` is not a
 * route and answers 404. The API gateway answers the same path so it can append
 * the delivery marker defined by `RequestPasswordResetResponseSchema`.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const body = await authRequest(
    "/v1/auth/request-password-reset",
    jsonInit("POST", {
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    }),
  );
  const parsed = RequestPasswordResetResponseSchema.safeParse(body);
  const delivery: EmailDeliveryMarker | undefined = parsed.success
    ? parsed.data.emailDelivery
    : undefined;
  if (delivery === "not_configured") {
    throw new EmailNotConfiguredError(MAIL_NOT_CONFIGURED_MESSAGE);
  }
  if (delivery === "failed") {
    throw new EmailDeliveryFailedError(MAIL_DELIVERY_FAILED_MESSAGE);
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await authRequest("/v1/auth/reset-password", jsonInit("POST", { token, newPassword }));
}

export async function verifyEmail(token: string): Promise<void> {
  await authRequest(`/v1/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: "GET",
  });
}

export async function signOut(): Promise<void> {
  await authRequest("/v1/auth/sign-out", jsonInit("POST", {}));
}

export async function getSecuritySession(): Promise<SecuritySession> {
  const response = await fetch("/v1/auth/get-session", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, "Session response was not JSON.", "INVALID_JSON");
    }
  }

  if (response.status === 401) {
    return { authenticated: false, twoFactorEnabled: false };
  }
  if (!response.ok) {
    throw errorFromResponse(response.status, body, "/v1/auth/get-session");
  }
  if (body === null) {
    return { authenticated: false, twoFactorEnabled: false };
  }
  if (typeof body !== "object") {
    throw new ApiError(200, "Session response was not an object.", "INVALID_RESPONSE");
  }

  const container = body as {
    user?: {
      email?: unknown;
      name?: unknown;
      twoFactorEnabled?: unknown;
    };
  };
  if (!container.user || typeof container.user.email !== "string") {
    return { authenticated: false, twoFactorEnabled: false };
  }
  return {
    authenticated: true,
    email: container.user.email,
    name: typeof container.user.name === "string" ? container.user.name : undefined,
    twoFactorEnabled: container.user.twoFactorEnabled === true,
  };
}

export async function enableTwoFactor(password: string): Promise<TwoFactorEnrollment> {
  const body = await authRequest(
    "/v1/auth/two-factor/enable",
    jsonInit("POST", { password, method: "totp" }),
  );
  const container = body as { totpURI?: unknown; backupCodes?: unknown } | null;
  if (typeof container?.totpURI !== "string" || !container.totpURI) {
    throw new ApiError(200, "认证服务没有返回 TOTP URI。", "INVALID_TWO_FACTOR_RESPONSE");
  }
  return {
    totpURI: container.totpURI,
    backupCodes: parseBackupCodes(container.backupCodes),
  };
}

export async function verifyTotp(code: string, trustDevice = false): Promise<void> {
  await authRequest("/v1/auth/two-factor/verify-totp", jsonInit("POST", { code, trustDevice }));
}

export async function verifyBackupCode(code: string, trustDevice = false): Promise<void> {
  await authRequest(
    "/v1/auth/two-factor/verify-backup-code",
    jsonInit("POST", { code, trustDevice }),
  );
}

export async function disableTwoFactor(password: string): Promise<void> {
  await authRequest("/v1/auth/two-factor/disable", jsonInit("POST", { password }));
}

export async function generateBackupCodes(password: string): Promise<string[]> {
  const body = await authRequest(
    "/v1/auth/two-factor/generate-backup-codes",
    jsonInit("POST", { password }),
  );
  const container = body as { backupCodes?: unknown } | null;
  return parseBackupCodes(container?.backupCodes);
}

function parseBackupCodes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // The API answers a doomed mail route with a readable code; its English
    // operator message ("set the mail provider in Admin settings") is not copy.
    if (error.code === "MAIL_NOT_CONFIGURED") return MAIL_NOT_CONFIGURED_MESSAGE;
    if (error.status === 401) return "邮箱或密码不正确，或账号尚未完成邮箱验证。";
    if (error.status === 403) return "当前账号没有权限完成此操作，请重新登录。";
    if (error.status === 429) return "尝试次数过多，请稍后再试。";
    return error.message;
  }
  return error instanceof Error ? error.message : "请求没有完成，请稍后重试。";
}

export function twoFactorErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "验证没有完成，请稍后重试。";
  }

  const code = error.code.toUpperCase();
  if (code.includes("INVALID_TWO_FACTOR_COOKIE")) {
    return "登录挑战已过期。请重新使用邮箱和密码登录。";
  }
  if (code.includes("INVALID_BACKUP_CODE")) {
    return "备用码无效或已经使用。每个备用码只能使用一次。";
  }
  if (code.includes("INVALID_CODE")) {
    return "验证码不正确或已过期。请在验证器中刷新后重试。";
  }
  if (code.includes("ACCOUNT_TEMPORARILY_LOCKED") || error.status === 429) {
    return "失败次数过多，2FA 已临时锁定。请约 15 分钟后重试，或改用未使用的备用码。";
  }
  if (code.includes("TOO_MANY_ATTEMPTS")) {
    return "本次登录挑战的尝试次数已用尽。请重新登录获取新的挑战。";
  }
  if (code.includes("INVALID_PASSWORD")) {
    return "当前密码不正确。请确认后重试；连续失败会触发临时锁定。";
  }
  if (error.status === 401) {
    return "验证失败。请检查验证码；连续失败会触发临时锁定。";
  }
  if (error.status === 403) {
    return "当前会话没有权限完成此操作。请重新登录后再试。";
  }
  if (error.status >= 500) {
    return "认证服务暂时不可用，请稍后再试。";
  }
  return error.message;
}

export interface TwoFactorAuthTransport {
  signIn(email: string, password: string): Promise<SignInResult>;
  verifyTotp(code: string): Promise<void>;
  verifyBackupCode(code: string): Promise<void>;
  getSecuritySession(): Promise<SecuritySession>;
  enableTwoFactor(password: string): Promise<TwoFactorEnrollment>;
  disableTwoFactor(password: string): Promise<void>;
  generateBackupCodes(password: string): Promise<string[]>;
}

export const twoFactorAuthTransport: TwoFactorAuthTransport = {
  signIn,
  verifyTotp,
  verifyBackupCode,
  getSecuritySession,
  enableTwoFactor,
  disableTwoFactor,
  generateBackupCodes,
};
