import {
  PublicTripResponseSchema,
  type ProblemDetails,
  type PublicTripResponse,
} from "@roamlog/contracts";

export type ShareScreen =
  | { kind: "loading" }
  | { kind: "password"; invalid?: boolean }
  | { kind: "error"; title: string; description: string; retryable?: boolean }
  | { kind: "ready"; data: PublicTripResponse };

/**
 * Maps the public endpoint's response to the share screen.
 *
 * This is shared by the server route and the client's password/retry path so
 * SSR and hydration produce the same state for the same response.
 */
export function shareScreenFromResponse(status: number, data: unknown): ShareScreen {
  if (status === 200) {
    const parsed = PublicTripResponseSchema.safeParse(data);
    if (!parsed.success) {
      return {
        kind: "error",
        title: "暂时无法读取分享",
        description: "分享服务返回了无法识别的内容，请稍后重试。",
        retryable: true,
      };
    }

    return { kind: "ready", data: parsed.data };
  }

  if (status === 401) {
    const problem = data as Partial<ProblemDetails> | null;
    return {
      kind: "password",
      invalid: problem?.code === "SHARE_PASSWORD_INVALID",
    };
  }

  if (status === 404) {
    return {
      kind: "error",
      title: "这个分享链接已失效",
      description: "链接可能已过期、被撤销，或从未存在。请联系分享者获取新的链接。",
    };
  }

  return {
    kind: "error",
    title: "暂时无法读取分享",
    description: "分享服务没有正常响应，请稍后重试。",
    retryable: true,
  };
}

export const SHARE_NETWORK_ERROR: ShareScreen = {
  kind: "error",
  title: "网络连接中断",
  description: "请检查网络后重试。分享内容不会保存在本机。",
  retryable: true,
};
