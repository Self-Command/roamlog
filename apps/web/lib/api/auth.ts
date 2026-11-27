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

/** The change-email confirmation is the link that has to arrive first. */
export const CHANGE_EMAIL_NOT_CONFIGURED_MESSAGE =
  "邮件服务未配置，无法发出确认邮件。请联系管理员配置邮件发送后重试。";

/** Same shape as {@link MAIL_DELIVERY_FAILED_MESSAGE}, for the email-change flow. */
export const CHANGE_EMAIL_DELIVERY_FAILED_MESSAGE =
  "确认邮件没有发出。请稍后重试；若持续失败，请联系管理员检查邮件服务。";

/** Registration exists, but the verification link never left the server. */
export const REGISTRATION_EMAIL_DELIVERY_FAILED_MESSAGE =
  "账号已创建，但验证邮件没有发出。请到“重新发送验证邮件”页面重试，或联系管理员检查邮件服务。";

export const VERIFICATION_MAIL_NOT_CONFIGURED_MESSAGE =
  "邮件服务未配置，无法发送验证邮件。请联系管理员配置邮件发送后重试。";

export const VERIFICATION_MAIL_DELIVERY_FAILED_MESSAGE =
  "验证邮件没有发出。请稍后重试；若持续失败，请联系管理员检查邮件服务。";

/** The account was created, but the first verification mail failed. */
export class RegistrationEmailDeliveryError extends Error {
  readonly code = "ACCOUNT_CREATED_EMAIL_DELIVERY_FAILED" as const;

  constructor() {
    super(REGISTRATION_EMAIL_DELIVERY_FAILED_MESSAGE);
    this.name = "RegistrationEmailDeliveryError";
  }
}

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

function readEmailDelivery(body: unknown): EmailDeliveryMarker | undefined {
  const parsed = RequestPasswordResetResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.emailDelivery : undefined;
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
  const body = await authRequest(
    "/v1/auth/sign-up/email",
    jsonInit("POST", { name, email, password }),
  );
  const delivery = readEmailDelivery(body);
  if (delivery) {
    throw new RegistrationEmailDeliveryError();
  }
}

export async function sendVerificationEmail(email: string): Promise<void> {
  let body: unknown;
  try {
    body = await authRequest(
      "/v1/auth/send-verification-email",
      jsonInit("POST", {
        email,
        callbackURL: `${window.location.origin}/login`,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "MAIL_NOT_CONFIGURED") {
      throw new EmailNotConfiguredError(VERIFICATION_MAIL_NOT_CONFIGURED_MESSAGE);
    }
    throw error;
  }
  const delivery = readEmailDelivery(body);
  if (delivery === "not_configured") {
    throw new EmailNotConfiguredError(VERIFICATION_MAIL_NOT_CONFIGURED_MESSAGE);
  }
  if (delivery === "failed") {
    throw new EmailDeliveryFailedError(VERIFICATION_MAIL_DELIVERY_FAILED_MESSAGE);
  }
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
  const delivery = readEmailDelivery(body);
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

/**
 * Confirms the signed-in user's current password without touching the account.
 *
 * `POST /change-email` accepts `{ newEmail }` only, so a "current password" field
 * on the email form would be decorative unless it is checked against something.
 * Better Auth 1.7.25 exposes `/verify-password` (a `sensitiveSession`-guarded
 * endpoint) exactly for this; the API gateway forwards every `/v1/auth/*` route
 * to Better Auth, so no backend work is involved.
 */
export async function verifyCurrentPassword(password: string): Promise<void> {
  await authRequest("/v1/auth/verify-password", jsonInit("POST", { password }));
}

/**
 * `POST /v1/auth/change-password` — `currentPassword` is re-verified by the auth
 * service; `revokeOtherSessions` stays `false` so the user is not signed out of
 * the device they are typing on.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  options: { revokeOtherSessions?: boolean } = {},
): Promise<void> {
  await authRequest(
    "/v1/auth/change-password",
    jsonInit("POST", {
      currentPassword,
      newPassword,
      revokeOtherSessions: options.revokeOtherSessions ?? false,
    }),
  );
}

/**
 * `POST /v1/auth/change-email` — Better Auth only accepts `newEmail` and
 * `callbackURL` here.
 *
 * With `user.changeEmail.sendChangeEmailConfirmation` enabled the first mail is
 * a confirmation **to the current address** (`better-auth.com/docs/concepts/users-accounts#confirming-with-current-email`);
 * clicking it makes Better Auth send the verification link to the new address,
 * and only that second click moves the address. The row keeps its old email
 * until then, which is why the form copy says "两封都完成后才生效".
 *
 * The API gateway appends `emailDelivery: "failed"` when the confirmation could
 * not be handed to the transport, so the form does not claim success for a mail
 * that never left.
 */
export async function changeEmail(newEmail: string, callbackURL?: string): Promise<void> {
  const body = await authRequest(
    "/v1/auth/change-email",
    jsonInit("POST", {
      newEmail,
      ...(callbackURL ? { callbackURL } : {}),
    }),
  );
  const delivery = readEmailDelivery(body);
  if (delivery === "not_configured") {
    throw new EmailNotConfiguredError(CHANGE_EMAIL_NOT_CONFIGURED_MESSAGE);
  }
  if (delivery === "failed") {
    throw new EmailDeliveryFailedError(CHANGE_EMAIL_DELIVERY_FAILED_MESSAGE);
  }
}

/**
 * `POST /v1/auth/revoke-sessions` — signs every *other* device out and keeps the
 * current one. Used by "退出所有其他设备".
 */
export async function revokeOtherSessions(): Promise<void> {
  await authRequest("/v1/auth/revoke-sessions", jsonInit("POST", {}));
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
    throw new ApiError(200, "登录验证暂时没有完成，请稍后重试。", "INVALID_TWO_FACTOR_RESPONSE");
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
    return "本次登录验证已过期。请重新使用邮箱和密码登录。";
  }
  if (code.includes("INVALID_BACKUP_CODE")) {
    return "备用码无效或已经使用。每个备用码只能使用一次。";
  }
  if (code.includes("INVALID_CODE")) {
    return "验证码不正确或已过期。请在验证器中刷新后重试。";
  }
  if (code.includes("ACCOUNT_TEMPORARILY_LOCKED") || error.status === 429) {
    return "失败次数过多，两步验证已临时锁定。请约 15 分钟后重试，或改用未使用的备用码。";
  }
  if (code.includes("TOO_MANY_ATTEMPTS")) {
    return "本次登录验证的尝试次数已用尽。请重新登录后再试。";
  }
  if (code.includes("INVALID_PASSWORD")) {
    return "当前密码不正确。请确认后重试；连续失败会触发临时锁定。";
  }
  if (error.status === 401) {
    return "验证失败。请检查验证码；连续失败会触发临时锁定。";
  }
  if (error.status === 403) {
    return "当前登录状态没有权限完成此操作。请重新登录后再试。";
  }
  if (error.status >= 500) {
    return "登录服务暂时不可用，请稍后再试。";
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

export type AccountSecurityAction = "password" | "email" | "password-verify";

/**
 * Copy for the account-security forms.
 *
 * Better Auth answers these routes with machine codes rather than prose, and a
 * disabled or unconfigured deployment must never read like a successful change.
 */
export function accountSecurityErrorMessage(error: unknown, action: AccountSecurityAction): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "请求没有完成，请稍后重试。";
  }

  const code = error.code.toUpperCase();
  if (code === "INVALID_PASSWORD") {
    return action === "password-verify" ? "当前密码不正确。" : "当前密码不正确，密码没有修改。";
  }
  if (code === "CHANGE_EMAIL_DISABLED") {
    return "当前服务没有开启邮箱修改。请联系管理员启用后重试。";
  }
  if (code.includes("INVALID_EMAIL")) {
    return "邮箱格式不正确。";
  }
  if (code.includes("EMAIL_ALREADY_EXISTS") || code.includes("USER_ALREADY_EXISTS")) {
    return "该邮箱已被其他账号使用。";
  }
  if (code.includes("EMAIL_IS_THE_SAME")) {
    return "新邮箱与当前邮箱相同。";
  }
  if (code.includes("PASSWORD_TOO_SHORT")) {
    return "新密码过短。请使用至少 8 个字符。";
  }
  if (code.includes("PASSWORD_TOO_LONG")) {
    return "新密码过长。请控制在 128 个字符以内。";
  }
  if (code === "SESSION_NOT_FRESH" || code.includes("SESSION_EXPIRED")) {
    return "本次登录已超过安全时效。请重新登录后再修改。";
  }
  if (code === "MAIL_NOT_CONFIGURED") return MAIL_NOT_CONFIGURED_MESSAGE;
  if (error.status === 401) return "当前登录状态已失效，请重新登录后再试。";
  if (error.status === 403) return "当前账号没有权限完成此操作。";
  if (error.status === 429) return "尝试次数过多，请稍后再试。";
  if (error.status >= 500) return "登录服务暂时不可用，请稍后再试。";
  return error.message;
}
