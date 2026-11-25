import { authPostHandler } from "@roamlog/api-client";

export interface AdminAuthResponse {
  status: number;
  data: Record<string, unknown>;
}

export interface AdminAuthTransport {
  signIn(input: { email: string; password: string }): Promise<AdminAuthResponse>;
  verifyTotp(code: string): Promise<AdminAuthResponse>;
  enableTotp(password: string): Promise<AdminAuthResponse>;
}

async function post(path: string, data: Record<string, unknown>): Promise<AdminAuthResponse> {
  const response = await authPostHandler(path, data, {
    credentials: "include",
  });
  return {
    status: response.status,
    data: response.data as Record<string, unknown>,
  };
}

export const generatedAdminAuthTransport: AdminAuthTransport = {
  signIn: (input) => post("sign-in/email", input),
  verifyTotp: (code) => post("two-factor/verify-totp", { code }),
  enableTotp: (password) => post("two-factor/enable", { password, method: "totp" }),
};

export function authErrorMessage(response: AdminAuthResponse): string {
  const message =
    response.data.message ?? response.data.detail ?? response.data.error ?? response.data.code;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return "登录没有完成，请检查账号信息后重试。";
}

export function authBackupCodes(response: AdminAuthResponse): string[] {
  const value = response.data.backupCodes;
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
