"use client";

import {
  AdminUserUpdateResponseSchema,
  type AdminUserUpdateResponse,
  type PlatformRole,
} from "@roamlog/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AdminMutationError, toAdminApiFailure } from "./admin-api-error";

export interface AdminUserProfileInput {
  name?: string;
  email?: string;
  locale?: string;
  timezone?: string;
  platformRole?: PlatformRole;
}

export interface AdminUserProfileForm {
  name: string;
  email: string;
  locale: string;
  timezone: string;
  platformRole: PlatformRole;
}

export interface AdminUserProfilePort {
  updateProfile(id: string, input: AdminUserProfileInput): Promise<AdminUserUpdateResponse>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Same-origin PATCH for the profile fields the generated client does not cover yet. */
export async function patchAdminUserProfile(
  id: string,
  input: AdminUserProfileInput,
): Promise<AdminUserUpdateResponse> {
  const response = await fetch(`/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }
  try {
    return AdminUserUpdateResponseSchema.parse(data);
  } catch (error) {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "后台 API 响应不符合契约",
      detail:
        error instanceof Error ? error.message : "无法解析更新后的用户响应。",
      degraded: [],
    });
  }
}

export function useAdminUserProfilePort(): AdminUserProfilePort {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { id: string; data: AdminUserProfileInput }) =>
      patchAdminUserProfile(input.id, input.data),
    onSuccess: async () => {
      // The detail drawer and the server-paginated list both read from the
      // `admin` namespace; refetching confirms what the API actually stored.
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return {
    updateProfile: (id, input) => mutation.mutateAsync({ id, data: input }),
  };
}

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

export function validateAdminUserProfileForm(
  form: AdminUserProfileForm,
): Partial<Record<keyof AdminUserProfileForm, string>> {
  const errors: Partial<Record<keyof AdminUserProfileForm, string>> = {};
  const name = form.name.trim();
  if (name.length === 0) {
    errors.name = "请输入姓名。";
  } else if (name.length > 120) {
    errors.name = "姓名不能超过 120 个字符。";
  }

  const email = form.email.trim();
  if (email.length === 0) {
    errors.email = "请输入邮箱。";
  } else if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "请输入有效邮箱地址。";
  }

  const locale = form.locale.trim();
  if (locale.length < 2 || locale.length > 20 || !LOCALE_PATTERN.test(locale)) {
    errors.locale = "语言使用 BCP 47 形式，例如 zh-CN 或 en-US。";
  }

  const timezone = form.timezone.trim();
  if (timezone.length === 0 || timezone.length > 64 || !TIMEZONE_PATTERN.test(timezone)) {
    errors.timezone = "时区使用 IANA 名称，例如 Asia/Shanghai。";
  }

  return errors;
}

/**
 * Map server codes to operator-facing copy. Anything unmapped keeps its code so
 * the console never invents a success or a vague "something went wrong".
 */
export function describeAdminUserEditError(error: unknown): string {
  if (!(error instanceof AdminMutationError)) {
    return "保存失败，请检查后台 API 与会话后重试。";
  }
  switch (error.failure.code) {
    case "EMAIL_TAKEN":
      return "该邮箱已被其他账户占用，请换一个邮箱。";
    case "LAST_SUPER_ADMIN":
      return "不能降级最后一个超级管理员，请先指定新的超级管理员。";
    case "SELF_DEMOTION_FORBIDDEN":
      return "不能降低自己的平台角色。";
    case "VALIDATION_ERROR":
      return "字段校验失败，请检查姓名、邮箱、语言与时区格式。";
    case "ADMIN_ACTION_FORBIDDEN":
      return "当前平台角色无权编辑用户资料（仅超级管理员）。";
    case "USER_NOT_FOUND":
      return "该用户不存在或已被移除。";
    case "ADMIN_2FA_REQUIRED":
      return "后台操作要求先完成双因素认证。";
    case "UNAUTHENTICATED":
      return "会话已失效，请重新登录。";
    default:
      return `保存失败：${error.failure.code} · ${error.failure.title}`;
  }
}

/** Delivery copy for an email change: never claim success when the mail failed. */
export function describeEmailDelivery(delivery: "sent" | "failed" | undefined): string {
  if (delivery === "failed") {
    return "邮箱已更新，但验证邮件未发出，请稍后重试。";
  }
  if (delivery === "sent") {
    return "邮箱已更新，已发送验证邮件。";
  }
  return "资料已保存，并已重新拉取详情确认。";
}