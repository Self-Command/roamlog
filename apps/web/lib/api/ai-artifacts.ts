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
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : `Artifact request failed with HTTP ${String(response.status)}.`;
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
