import {
  AiConversationListResponseSchema,
  AiConversationMessagesResponseSchema,
  AiConversationBulkDeleteResponseSchema,
  AiConversationSchema,
  AiConversationTitleResponseSchema,
  AiThreadMessageSchema,
  MessageResponseSchema,
  type AiConversation,
  type AiConversationBulkDeleteResponse,
  type AiConversationListResponse,
  type AiConversationMessagesResponse,
  type AiConversationTitleResponse,
  type AiThreadMessage,
} from "@roamlog/contracts";
import {
  archiveAiConversation as archiveAiConversationRequest,
  createAiConversation as createAiConversationRequest,
  deleteAllAiConversations as deleteAllAiConversationsRequest,
  deleteAiConversation as deleteAiConversationRequest,
  deleteAiConversationMessages as deleteAiConversationMessagesRequest,
  generateAiConversationTitle as generateAiConversationTitleRequest,
  getAiConversation as getAiConversationRequest,
  listAiConversationMessages as listAiConversationMessagesRequest,
  listAiConversations as listAiConversationsRequest,
  unarchiveAiConversation as unarchiveAiConversationRequest,
  updateAiConversation as updateAiConversationRequest,
  upsertAiConversationMessage as upsertAiConversationMessageRequest,
  type CreateAiConversationBody,
  type DeleteAiConversationMessagesBody,
  type ListAiConversationsParams,
  type UpdateAiConversationBody,
  type UpsertAiConversationMessageBody,
} from "@roamlog/api-client";

import { ApiError, isApiError } from "./errors";
import { unwrap } from "./shared";

/**
 * Thin client for the persisted AI conversation REST surface.
 *
 * The generated `@roamlog/api-client` functions are the single transport
 * implementation — this module only adds three things the UI needs:
 *
 * 1. workspaceId is injected in exactly one place, so a component can never
 *    forget it or invent its own URL;
 * 2. every response is validated against the contract schema before it reaches
 *    assistant-ui;
 * 3. every failure becomes one Chinese, user-facing message with a
 *    `retryable` flag, while the original HTTP status/code stays on the error
 *    for shared helpers (`isForbidden`, `isUnauthorized`, ...) and diagnostics.
 */

/** The server caps a conversation page at 100; the sidebar asks for one page. */
export const AI_CONVERSATION_PAGE_LIMIT = 100;

export class AiConversationError extends ApiError {
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, retryable: boolean) {
    super(status, message, code);
    this.name = "AiConversationError";
    this.retryable = retryable;
  }
}

function conversationPath(workspaceId: string, suffix = ""): string {
  return `/v1/workspaces/${workspaceId}/ai/conversations${suffix}`;
}

/**
 * Maps transport/HTTP failures to one Chinese sentence.
 *
 * 5xx and network failures are retryable because repeating the same request is
 * safe: every write is either idempotent (`PUT .../messages/{clientId}`) or a
 * state transition the server already makes idempotent (archive/unarchive).
 */
function toConversationError(error: unknown): AiConversationError {
  if (error instanceof AiConversationError) return error;

  if (error instanceof TypeError) {
    return new AiConversationError(
      0,
      "NETWORK_ERROR",
      "无法连接 AI 会话服务，请检查网络后重试。",
      true,
    );
  }

  if (isApiError(error)) {
    const status = error.status;
    const code = error.code;
    if (status === 401) {
      return new AiConversationError(status, code, "登录状态已失效，请重新登录。", false);
    }
    if (status === 403) {
      return new AiConversationError(
        status,
        code,
        "你没有权限访问这个 Workspace 的 AI 会话。",
        false,
      );
    }
    if (status === 404) {
      return new AiConversationError(status, code, "AI 会话不存在，可能已被删除。", false);
    }
    if (status === 429) {
      return new AiConversationError(status, code, "请求过于频繁，请稍后再试。", true);
    }
    if (status >= 500) {
      return new AiConversationError(status, code, "AI 会话服务暂时不可用，请稍后重试。", true);
    }
    if (status === 0) {
      return new AiConversationError(
        status,
        code,
        "无法连接 AI 会话服务，请检查网络后重试。",
        true,
      );
    }
    return new AiConversationError(status, code, "AI 会话操作失败，请刷新后重试。", false);
  }

  return new AiConversationError(
    0,
    "AI_CONVERSATION_FAILED",
    "AI 会话操作失败，请稍后重试。",
    true,
  );
}

async function run<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw toConversationError(error);
  }
}

export async function listConversations(
  workspaceId: string,
  params?: ListAiConversationsParams,
): Promise<AiConversationListResponse> {
  const path = conversationPath(workspaceId);
  return run(async () =>
    unwrap(
      await listAiConversationsRequest(workspaceId, params),
      AiConversationListResponseSchema,
      path,
    ),
  );
}

export async function createConversation(
  workspaceId: string,
  input: CreateAiConversationBody = {},
): Promise<AiConversation> {
  const path = conversationPath(workspaceId);
  return run(async () =>
    unwrap(await createAiConversationRequest(workspaceId, input), AiConversationSchema, path),
  );
}

export async function deleteAllConversations(
  workspaceId: string,
): Promise<AiConversationBulkDeleteResponse> {
  const path = conversationPath(workspaceId);
  return run(async () =>
    unwrap(
      await deleteAllAiConversationsRequest(workspaceId),
      AiConversationBulkDeleteResponseSchema,
      path,
    ),
  );
}

export async function getConversation(
  workspaceId: string,
  conversationId: string,
): Promise<AiConversation> {
  const path = conversationPath(workspaceId, `/${conversationId}`);
  return run(async () =>
    unwrap(await getAiConversationRequest(workspaceId, conversationId), AiConversationSchema, path),
  );
}

export async function renameConversation(
  workspaceId: string,
  conversationId: string,
  title: string,
): Promise<AiConversation> {
  const path = conversationPath(workspaceId, `/${conversationId}`);
  const body: UpdateAiConversationBody = { title };
  return run(async () =>
    unwrap(
      await updateAiConversationRequest(workspaceId, conversationId, body),
      AiConversationSchema,
      path,
    ),
  );
}

export async function deleteConversation(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const path = conversationPath(workspaceId, `/${conversationId}`);
  await run(async () => {
    unwrap(
      await deleteAiConversationRequest(workspaceId, conversationId),
      MessageResponseSchema,
      path,
    );
  });
}

export async function archiveConversation(
  workspaceId: string,
  conversationId: string,
): Promise<AiConversation> {
  const path = conversationPath(workspaceId, `/${conversationId}/archive`);
  return run(async () =>
    unwrap(
      await archiveAiConversationRequest(workspaceId, conversationId),
      AiConversationSchema,
      path,
    ),
  );
}

export async function unarchiveConversation(
  workspaceId: string,
  conversationId: string,
): Promise<AiConversation> {
  const path = conversationPath(workspaceId, `/${conversationId}/unarchive`);
  return run(async () =>
    unwrap(
      await unarchiveAiConversationRequest(workspaceId, conversationId),
      AiConversationSchema,
      path,
    ),
  );
}

export async function listConversationMessages(
  workspaceId: string,
  conversationId: string,
): Promise<AiConversationMessagesResponse> {
  const path = conversationPath(workspaceId, `/${conversationId}/messages`);
  return run(async () =>
    unwrap(
      await listAiConversationMessagesRequest(workspaceId, conversationId),
      AiConversationMessagesResponseSchema,
      path,
    ),
  );
}

export async function upsertConversationMessage(
  workspaceId: string,
  conversationId: string,
  clientId: string,
  body: UpsertAiConversationMessageBody,
): Promise<AiThreadMessage> {
  const path = conversationPath(
    workspaceId,
    `/${conversationId}/messages/${encodeURIComponent(clientId)}`,
  );
  return run(async () =>
    unwrap(
      await upsertAiConversationMessageRequest(workspaceId, conversationId, clientId, body),
      AiThreadMessageSchema,
      path,
    ),
  );
}

export async function deleteConversationMessages(
  workspaceId: string,
  conversationId: string,
  ids: readonly string[],
): Promise<void> {
  const path = conversationPath(workspaceId, `/${conversationId}/messages`);
  const body: DeleteAiConversationMessagesBody = { ids: [...ids] };
  await run(async () => {
    unwrap(
      await deleteAiConversationMessagesRequest(workspaceId, conversationId, body),
      MessageResponseSchema,
      path,
    );
  });
}

export async function generateConversationTitle(
  workspaceId: string,
  conversationId: string,
): Promise<AiConversationTitleResponse> {
  const path = conversationPath(workspaceId, `/${conversationId}/title/generate`);
  return run(async () =>
    unwrap(
      await generateAiConversationTitleRequest(workspaceId, conversationId),
      AiConversationTitleResponseSchema,
      path,
    ),
  );
}
