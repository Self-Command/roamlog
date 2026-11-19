import type { ProblemDetails } from "@roamlog/api-client";

export interface AdminApiFailure {
  code: string;
  status: number;
  title: string;
  detail: string;
  degraded: string[];
  /**
   * Raw `probe` object from a `422 SETTINGS_PROBE_FAILED` body (target, code,
   * checks). Kept as `unknown` because that endpoint-level shape is not part of
   * the shared contract; `apps/admin/components/settings/probe-error-copy.ts`
   * parses it into a typed `SettingsProbe`. Dropping it here would silently
   * degrade the settings console back to a generic "rejected" message.
   */
  probe?: unknown;
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

export function toAdminApiFailure(
  status: number,
  data: unknown,
  headers?: Headers | null,
): AdminApiFailure {
  const degraded = (headers?.get("x-roamlog-degraded") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (isProblemDetails(data)) {
    const probe = (data as { probe?: unknown }).probe;
    return {
      code: data.code,
      status: data.status || status,
      title: data.title,
      detail: data.detail ?? data.title,
      degraded,
      ...(probe === undefined ? {} : { probe }),
    };
  }

  return {
    code: `HTTP_${status}`,
    status,
    title: status === 401 ? "需要登录" : "后台 API 请求失败",
    detail:
      status === 401
        ? "后台会话缺失或已过期，请重新登录后继续。"
        : "后台 API 返回了异常响应。",
    degraded,
  };
}

export class AdminMutationError extends Error {
  readonly failure: AdminApiFailure;

  constructor(failure: AdminApiFailure) {
    super(failure.detail);
    this.name = "AdminMutationError";
    this.failure = failure;
  }
}

export function assertAdminResponse<T>(
  response: { status: number; data: T; headers?: Headers },
  context: string,
): T {
  const degraded = (response.headers?.get("x-roamlog-degraded") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (response.status >= 200 && response.status < 300) {
    if (degraded.length > 0) {
      console.warn(`[admin-api] ${context} degraded: ${degraded.join(", ")}`);
    }
    return response.data;
  }

  throw new AdminMutationError(toAdminApiFailure(response.status, response.data, response.headers));
}
