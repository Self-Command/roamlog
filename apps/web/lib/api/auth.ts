import { ApiError, errorFromResponse } from "./errors";

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

export async function signIn(email: string, password: string): Promise<void> {
  await authRequest(
    "/v1/auth/sign-in/email",
    jsonInit("POST", { email, password, rememberMe: true }),
  );
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  await authRequest(
    "/v1/auth/sign-up/email",
    jsonInit("POST", { name, email, password }),
  );
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

export async function requestPasswordReset(email: string): Promise<void> {
  await authRequest(
    "/v1/auth/forget-password",
    jsonInit("POST", {
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    }),
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await authRequest(
    "/v1/auth/reset-password",
    jsonInit("POST", { token, newPassword }),
  );
}

export async function verifyEmail(token: string): Promise<void> {
  await authRequest(`/v1/auth/verify-email?token=${encodeURIComponent(token)}`, {
    method: "GET",
  });
}

export async function signOut(): Promise<void> {
  await authRequest("/v1/auth/sign-out", jsonInit("POST", {}));
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "邮箱或密码不正确，或账号尚未完成邮箱验证。";
    if (error.status === 429) return "尝试次数过多，请稍后再试。";
    return error.message;
  }
  return error instanceof Error ? error.message : "请求没有完成，请稍后重试。";
}

void errorFromResponse;
