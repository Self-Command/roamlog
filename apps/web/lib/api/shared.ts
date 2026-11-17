import { errorFromResponse, invalidResponse, problemFromBody } from "./errors";

export interface ApiEnvelope<T = unknown> {
  data: T;
  status: number;
}

interface SchemaLike<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
}

export function unwrap<T>(
  result: ApiEnvelope,
  schema: SchemaLike<T>,
  path: string,
): T {
  if (result.status >= 400) {
    throw errorFromResponse(result.status, result.data, path);
  }

  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw invalidResponse(path, parsed.error.issues[0]?.message);
  }

  return parsed.data;
}

export function unwrapMessage(
  result: ApiEnvelope,
  path: string,
): void {
  if (result.status >= 400) {
    throw errorFromResponse(result.status, result.data, path);
  }
}

export function parseProblemBody(body: unknown) {
  return problemFromBody(body);
}
