import {
  AiArtifactListResponseSchema,
  AiArtifactSchema,
  AiArtifactSuggestionSchema,
  AiArtifactSuggestionsResponseSchema,
  AiArtifactVersionsResponseSchema,
  type AiArtifact,
  type AiArtifactKind,
  type AiArtifactListResponse,
  type AiArtifactSuggestion,
  type AiArtifactVersion,
} from "@roamlog/contracts";

export type { AiArtifact, AiArtifactKind, AiArtifactSuggestion, AiArtifactVersion };

function artifactPath(workspaceId: string, suffix = ""): string {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/artifacts${suffix}`;
}

interface SchemaLike<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false };
}

const ARTIFACT_ERROR_COPY: Readonly<Record<string, string>> = {
  AI_ARTIFACT_NOT_FOUND: "文档不存在或已被删除。",
  AI_ARTIFACT_VERSION_CONFLICT: "文档已在另一个窗口更新，请重新加载后再修改。",
  AI_ARTIFACT_VERSION_NOT_FOUND: "这个历史版本不存在，请重新加载。",
  AI_ARTIFACT_SUGGESTION_NOT_FOUND: "这条建议不存在或已被处理。",
  AI_ARTIFACT_IMAGE_SOURCE_INVALID: "图片还没有准备好，请重新选择。",
  AI_ARTIFACT_CONTENT_TOO_LARGE: "文档内容超出大小限制。",
  AI_ARTIFACT_EMPTY: "文档内容为空，请先写入内容。",
} as const;

async function request<T>(
  path: string,
  schema: SchemaLike<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : null;
    const message =
      (code ? ARTIFACT_ERROR_COPY[code] : undefined) ??
      (body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
          ? body.detail
          : `文档请求失败（HTTP ${String(response.status)}），请重试。`);
    throw new Error(message);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Artifact 响应格式不正确。");
  }
  return parsed.data;
}

export async function listAiArtifacts(
  workspaceId: string,
  options: {
    conversationId?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<AiArtifactListResponse> {
  const query = new URLSearchParams();
  if (options.conversationId) query.set("conversationId", options.conversationId);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request(
    artifactPath(workspaceId, suffix),
    AiArtifactListResponseSchema,
    options.signal ? { signal: options.signal } : undefined,
  );
}

export async function getAiArtifact(
  workspaceId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<AiArtifact> {
  return request(
    artifactPath(workspaceId, `/${encodeURIComponent(artifactId)}`),
    AiArtifactSchema,
    signal ? { signal } : undefined,
  );
}

export async function createAiArtifact(
  workspaceId: string,
  input: {
    title: string;
    kind: AiArtifactKind;
    content?: string;
    conversationId?: string;
    mediaId?: string;
  },
): Promise<AiArtifact> {
  return request(artifactPath(workspaceId), AiArtifactSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAiArtifact(
  workspaceId: string,
  artifactId: string,
  input: { version: number; title?: string; content?: string; mediaId?: string | null },
): Promise<AiArtifact> {
  return request(
    artifactPath(workspaceId, `/${encodeURIComponent(artifactId)}`),
    AiArtifactSchema,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function listAiArtifactVersions(
  workspaceId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<readonly AiArtifactVersion[]> {
  const body = await request(
    artifactPath(workspaceId, `/${encodeURIComponent(artifactId)}/versions`),
    AiArtifactVersionsResponseSchema,
    signal ? { signal } : undefined,
  );
  return body.versions;
}

export async function restoreAiArtifactVersion(
  workspaceId: string,
  artifactId: string,
  version: number,
): Promise<AiArtifact> {
  return request(
    artifactPath(
      workspaceId,
      `/${encodeURIComponent(artifactId)}/versions/${String(version)}/restore`,
    ),
    AiArtifactSchema,
    { method: "POST" },
  );
}

export async function listAiArtifactSuggestions(
  workspaceId: string,
  artifactId: string,
  signal?: AbortSignal,
): Promise<readonly AiArtifactSuggestion[]> {
  const body = await request(
    artifactPath(workspaceId, `/${encodeURIComponent(artifactId)}/suggestions`),
    AiArtifactSuggestionsResponseSchema,
    signal ? { signal } : undefined,
  );
  return body.suggestions;
}

export async function setAiArtifactSuggestionResolved(
  workspaceId: string,
  artifactId: string,
  suggestionId: string,
  isResolved: boolean,
): Promise<AiArtifactSuggestion> {
  return request(
    artifactPath(
      workspaceId,
      `/${encodeURIComponent(artifactId)}/suggestions/${encodeURIComponent(suggestionId)}`,
    ),
    AiArtifactSuggestionSchema,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isResolved }),
    },
  );
}

export async function deleteAiArtifact(
  workspaceId: string,
  artifactId: string,
): Promise<void> {
  const response = await fetch(artifactPath(workspaceId, `/${encodeURIComponent(artifactId)}`), {
    credentials: "include",
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Artifact delete failed with HTTP ${String(response.status)}.`);
  }
}
