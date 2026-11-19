"use client";

import {
  AdminPermissionsResponseSchema,
  type AdminPermissionChange,
  type AdminPermissionsResponse,
} from "@roamlog/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  AdminMutationError,
  toAdminApiFailure,
  type AdminApiFailure,
} from "./admin-api-error";

export interface AdminPermissionsResource {
  data: AdminPermissionsResponse | null;
  isLoading: boolean;
  error: AdminApiFailure | null;
  refetch: () => void;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function readPermissionsMatrix(): Promise<AdminPermissionsResponse> {
  const response = await fetch("/v1/admin/permissions", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }
  try {
    return AdminPermissionsResponseSchema.parse(data);
  } catch (error) {
    throw new AdminMutationError({
      code: "ADMIN_RESPONSE_INVALID",
      status: response.status,
      title: "后台 API 响应不符合契约",
      detail:
        error instanceof Error ? error.message : "无法解析权限矩阵响应。",
      degraded: [],
    });
  }
}

export function useAdminPermissionsMatrix(): AdminPermissionsResource {
  const query = useQuery({
    queryKey: ["admin", "permissions", "matrix"],
    queryFn: readPermissionsMatrix,
  });

  const error = query.error
    ? query.error instanceof AdminMutationError
      ? query.error.failure
      : {
          code: "ADMIN_API_NETWORK",
          status: 0,
          title: "后台 API 不可用",
          detail:
            query.error instanceof Error
              ? query.error.message
              : "无法完成权限矩阵请求。",
          degraded: [],
        }
    : null;

  return {
    data: error ? null : (query.data ?? null),
    isLoading: query.isLoading,
    error,
    refetch: () => {
      void query.refetch();
    },
  };
}

export async function patchAdminPermissions(changes: AdminPermissionChange[]): Promise<void> {
  const response = await fetch("/v1/admin/permissions", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ changes }),
  });
  const text = await response.text();
  const data = text ? parseJson(text) : null;

  if (response.status < 200 || response.status >= 300) {
    throw new AdminMutationError(toAdminApiFailure(response.status, data, response.headers));
  }
}

export function useAdminPermissionsUpdate(): {
  save: (changes: AdminPermissionChange[]) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: patchAdminPermissions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "permissions"] });
    },
  });

  return { save: (changes) => mutation.mutateAsync(changes) };
}

export function describeAdminPermissionsError(error: unknown): string {
  if (!(error instanceof AdminMutationError)) {
    return "保存失败，请检查后台 API 与会话后重试。";
  }
  switch (error.failure.code) {
    case "PERMISSION_NOT_GRANTABLE":
      return "该动作属于安全敏感权限，界面不可授予。";
    case "ADMIN_ACTION_FORBIDDEN":
      return "仅超级管理员可修改权限矩阵。";
    case "ADMIN_2FA_REQUIRED":
      return "后台操作要求先完成双因素认证。";
    case "UNAUTHENTICATED":
      return "会话已失效，请重新登录。";
    case "VALIDATION_ERROR":
      return "权限变更请求未通过校验，请刷新后重试。";
    default:
      return `保存失败：${error.failure.code} · ${error.failure.title}`;
  }
}