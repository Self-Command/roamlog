import {
  AiRewriteResponseSchema,
  type AiRewriteInstruction,
  type AiRewriteLocale,
  type AiRewriteResponse,
} from "@roamlog/contracts";

import { errorFromResponse } from "../api/errors";
import { AiRequestError, aiFailureKind, toAiRequestError } from "../api/ai";
import { hashSelection, type SubtleLike } from "./selection";

/**
 * Client for `POST /v1/workspaces/{workspaceId}/ai/rewrite`.
 *
 * Deliberately not reusing the planner client: this endpoint answers 200 with a
 * body the caller must treat as *preview data*, never as text to write. The only
 * thing it shares with the planner is the error taxonomy, so a quota failure
 * looks the same to the user wherever it happens.
 */

export interface RewriteSelectionInput {
  /** The exact selected string. The server re-hashes it and rejects a mismatch. */
  text: string;
  instruction: AiRewriteInstruction;
  /** SHA-256 of `text`; see `hashSelection`. */
  selectionHash: string;
  /** Context only. It never scopes the write. */
  tripId?: string;
  locale?: AiRewriteLocale;
}

interface SchemaLike<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
}

/** Rewrites one selection. Returns preview data; it persists nothing. */
export async function rewriteSelection(
  workspaceId: string,
  input: RewriteSelectionInput,
  schema: SchemaLike<AiRewriteResponse> = AiRewriteResponseSchema,
): Promise<AiRewriteResponse> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/rewrite`;
  const body: Record<string, unknown> = {
    text: input.text,
    instruction: input.instruction,
    selectionHash: input.selectionHash,
  };
  if (input.tripId) body.tripId = input.tripId;
  if (input.locale) body.locale = input.locale;

  let response: Response;
  let text: string;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    text = await response.text();
  } catch (cause) {
    throw toAiRequestError(cause);
  }

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new AiRequestError(
          response.status,
          `The AI response for ${path} was not JSON.`,
          "INVALID_RESPONSE",
          "invalid_response",
        );
      }
    }
  }

  if (!response.ok) {
    throw toAiRequestError(errorFromResponse(response.status, payload, path));
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AiRequestError(
      response.status,
      parsed.error.issues[0]?.message ?? `The AI response for ${path} did not match the contract.`,
      "INVALID_RESPONSE",
      "invalid_response",
    );
  }

  return parsed.data;
}

/**
 * True when the text the preview was built from is still the text under the
 * user's cursor. Called immediately before replacing, so a paragraph that
 * changed while the model was running cannot be overwritten with a stale rewrite.
 */
export async function selectionStillMatches(
  expectedHash: string,
  currentText: string,
  subtle?: SubtleLike,
): Promise<boolean> {
  return (await hashSelection(currentText, subtle)) === expectedHash;
}

/**
 * User-facing copy for a failed rewrite. The selection-mismatch wording is fixed
 * by the product contract — it must tell the user the source text moved and ask
 * them to retry, because nothing was written.
 */
export function rewriteFailureMessage(error: unknown): string {
  if (error instanceof AiRequestError) {
    switch (error.code) {
      case "AI_SELECTION_HASH_MISMATCH":
        return "原文已变化，请重试";
      case "AI_REWRITE_TEXT_TOO_LONG":
        return "选中文本过长，请分段改写";
      case "AI_NOT_CONFIGURED":
        return "当前站点未配置 AI，暂时无法改写";
      case "AI_REWRITE_EMPTY":
        return "AI 没有给出可用结果，请重试";
      default:
        break;
    }

    switch (error.kind) {
      case "quota":
        return "今天的 AI 额度已用完，请稍后再试";
      case "forbidden":
        return "你没有编辑这段日志的权限";
      case "unauthorized":
        return "登录状态已过期，请重新登录";
      case "network":
        return "网络不可用，请检查连接后重试";
      case "upstream":
        return "AI 服务暂时不可用，请重试";
      case "invalid_request":
        return "这次改写请求不合法，请重新选择文本";
      default:
        return "改写失败，请重试";
    }
  }

  return "改写失败，请重试";
}

/** Exposed for parity assertions in tests. */
export const rewriteFailureKind = aiFailureKind;
