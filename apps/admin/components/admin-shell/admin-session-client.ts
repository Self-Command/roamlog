import { authPostHandler } from "@roamlog/api-client";

export class AdminSignOutError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminSignOutError";
  }
}

/**
 * Ends the Better Auth session for real. The admin app proxies `/v1/*` to the
 * API, which forwards `/v1/auth/sign-out` to Better Auth and relays the
 * `Set-Cookie` that clears the httpOnly session cookie.
 */
export async function signOutAdminSession(): Promise<void> {
  let response: Awaited<ReturnType<typeof authPostHandler>>;
  try {
    response = await authPostHandler("sign-out", {}, { credentials: "include" });
  } catch {
    throw new AdminSignOutError(0, "无法连接认证服务，退出登录失败。");
  }

  // Widen to number: the generated union omits 401, but Better Auth can still
  // report "already signed out" at runtime. Treat that as success.
  const status: number = response.status;
  if (status >= 400 && status !== 401) {
    throw new AdminSignOutError(status, `退出登录失败（HTTP ${status}）。`);
  }
}

export function adminSignOutErrorMessage(error: unknown): string {
  if (error instanceof AdminSignOutError) {
    if (error.status === 0) {
      return "无法连接认证服务，退出登录失败。";
    }
    return `退出登录失败（HTTP ${error.status}），当前会话仍然有效。`;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "退出登录失败，当前会话仍然有效。";
}
