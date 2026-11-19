import {
  AdminSettingsResponseSchema,
  RevealAdminSettingResponseSchema,
  UpdateAdminSettingsResponseSchema,
  type AdminSettingUpdate,
  type AdminSettingsResponse,
  type RevealAdminSettingResponse,
  type UpdateAdminSettingsResponse,
} from "@roamlog/contracts";

import { AdminMutationError, toAdminApiFailure, type AdminApiFailure } from "./admin-api-error";
import { fieldErrorMessages } from "./admin-settings";

export interface AdminSettingsFieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * 422 `SETTINGS_INVALID` carries per-key errors. They are kept separate from
 * the generic failure so the form can attach each message to its field without
 * discarding what the operator typed.
 */
export class AdminSettingsError extends AdminMutationError {
  readonly fieldErrors: readonly AdminSettingsFieldError[];
  readonly errorsByField: Record<string, string>;

  constructor(
    failure: AdminApiFailure,
    fieldErrors: readonly AdminSettingsFieldError[] = [],
  ) {
    super(failure);
    this.name = "AdminSettingsError";
    this.fieldErrors = fieldErrors;
    this.errorsByField = fieldErrorMessages(fieldErrors);
  }

  get status(): number {
    return this.failure.status;
  }
}

export interface AdminSettingsApi {
  list(): Promise<AdminSettingsResponse>;
  update(updates: readonly AdminSettingUpdate[]): Promise<UpdateAdminSettingsResponse>;
  reveal(key: string): Promise<RevealAdminSettingResponse>;
}

function parseFieldErrors(payload: unknown): AdminSettingsFieldError[] {
  if (typeof payload !== "object" || payload === null || !("errors" in payload)) {
    return [];
  }
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { field?: unknown }).field !== "string" ||
      typeof (entry as { code?: unknown }).code !== "string" ||
      typeof (entry as { message?: unknown }).message !== "string"
    ) {
      return [];
    }
    return [
      {
        field: (entry as { field: string }).field,
        code: (entry as { code: string }).code,
        message: (entry as { message: string }).message,
      },
    ];
  });
}

function failureFromResponse(
  status: number,
  payload: unknown,
  headers: Headers,
): AdminSettingsError {
  return new AdminSettingsError(
    toAdminApiFailure(status, payload, headers),
    parseFieldErrors(payload),
  );
}

function invalidResponse(status: number, detail: string): AdminMutationError {
  return new AdminMutationError({
    code: "ADMIN_RESPONSE_INVALID",
    status,
    title: "Admin API response did not match the contract",
    detail,
    degraded: [],
  });
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const response = await fetchImpl(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (response.status < 200 || response.status >= 300) {
    throw failureFromResponse(response.status, payload, response.headers);
  }
  if (payload === null) {
    throw invalidResponse(response.status, "The Admin API returned an empty or non-JSON body.");
  }

  try {
    return schema.parse(payload);
  } catch (error) {
    throw invalidResponse(
      response.status,
      error instanceof Error ? error.message : "The Admin API response could not be parsed.",
    );
  }
}

/** Same-origin client for the five settings endpoints the console uses. */
export function createAdminSettingsApi(fetchImpl: typeof fetch = fetch): AdminSettingsApi {
  return {
    list: () =>
      requestJson(fetchImpl, "/v1/admin/settings", { method: "GET" }, AdminSettingsResponseSchema),
    update: (updates) =>
      requestJson(
        fetchImpl,
        "/v1/admin/settings",
        { method: "PATCH", body: JSON.stringify({ updates: [...updates] }) },
        UpdateAdminSettingsResponseSchema,
      ),
    reveal: (key) =>
      requestJson(
        fetchImpl,
        `/v1/admin/settings/${encodeURIComponent(key)}/reveal`,
        { method: "POST", body: JSON.stringify({ confirm: true }) },
        RevealAdminSettingResponseSchema,
      ),
  };
}

export const adminSettingsApi: AdminSettingsApi = createAdminSettingsApi();