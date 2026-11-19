import {
  CreateReportResponseSchema,
  type CreateReportRequest,
  type CreateReportResponse,
} from "@roamlog/contracts";

import { errorFromResponse } from "@/lib/api/errors";
import { invalidResponse } from "@/lib/api/errors";

const API_BASE = "";

/**
 * Submits a user report. Kept as a plain fetch (instead of the generated
 * api-client) because the moderation contract is not part of the Orval
 * generation pass yet; it still reuses the shared Problem Details error path
 * so callers get an `ApiError` with the API `code`.
 */
export async function submitReport(
  workspaceId: string,
  input: Omit<CreateReportRequest, "detail"> & { detail?: string },
): Promise<CreateReportResponse> {
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/reports`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }

  if (response.status < 200 || response.status >= 300) {
    throw errorFromResponse(response.status, body, path);
  }

  const parsed = CreateReportResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw invalidResponse(path, parsed.error.issues[0]?.message);
  }
  return parsed.data;
}