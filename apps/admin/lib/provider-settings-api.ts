import {
  ProviderCatalogSchema,
  ProviderConnectionSchema,
  ProviderDeleteResponseSchema,
  ProviderGroupResponseSchema,
  ProviderModelSchema,
  ProviderModelDiscoveryResponseSchema,
  ProviderProbeResponseSchema,
  ProviderSecretRevealResponseSchema,
  ProviderSecretStateSchema,
  type CreateProviderRequest,
  type ProviderCatalog,
  type ProviderConnection,
  type ProviderDraftProbeRequest,
  type ProviderGroup,
  type ProviderGroupResponse,
  type ProviderModel,
  type UpdateProviderModelRequest,
  type ProviderModelDiscoveryRequest,
  type ProviderModelDiscoveryResponse,
  type ProviderProbeResponse,
  type ProviderSecretRevealResponse,
  type ProviderSecretState,
  type ReplaceProviderSecretRequest,
  type UpdateProviderPolicyRequest,
  type UpdateProviderRequest,
} from "@roamlog/contracts";

import { adminSettingsErrorFromResponse } from "./admin-settings-api";
import { AdminMutationError } from "./admin-api-error";

export type ProviderGroupKey = ProviderGroup;
export type ProviderCatalogResponse = ProviderCatalog;
export type ProviderPolicyUpdate = UpdateProviderPolicyRequest;
export type ProviderCreateInput = CreateProviderRequest;
export type ProviderUpdateInput = UpdateProviderRequest;
export type ProviderDraftProbeInput = ProviderDraftProbeRequest;
export type ReplaceProviderSecretInput = ReplaceProviderSecretRequest;

export interface ProviderRequestOptions {
  signal?: AbortSignal;
}

/**
 * Local presentation alias only. `modelCount` and `defaultModel` are joined
 * from the model catalog by a later UI task; they are not provider wire fields.
 */
export type AdminProviderSummary = ProviderConnection & {
  modelCount?: number;
  defaultModel?: string | null;
};

export interface ProviderSettingsApi {
  catalog(): Promise<ProviderCatalog>;
  group(group: ProviderGroup): Promise<ProviderGroupResponse>;
  updatePolicy(group: ProviderGroup, input: ProviderPolicyUpdate): Promise<ProviderGroupResponse>;
  reorder(
    group: ProviderGroup,
    ids: string[],
    expectedGroupVersion: number,
  ): Promise<ProviderGroupResponse>;
  create(input: ProviderCreateInput): Promise<AdminProviderSummary>;
  update(id: string, input: ProviderUpdateInput): Promise<AdminProviderSummary>;
  remove(id: string, expectedVersion: number): Promise<void>;
  probe(id: string, expectedVersion: number): Promise<ProviderProbeResponse>;
  probeDraft(input: ProviderDraftProbeInput): Promise<ProviderProbeResponse>;
  discoverModels(
    input: ProviderModelDiscoveryRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderModelDiscoveryResponse>;
  refreshModels(
    id: string,
    expectedVersion: number,
    options?: ProviderRequestOptions,
  ): Promise<ProviderModelDiscoveryResponse>;
  updateModel(
    id: string,
    modelId: string,
    input: UpdateProviderModelRequest,
  ): Promise<ProviderModel>;
  replaceSecret(
    id: string,
    field: string,
    input: ReplaceProviderSecretInput,
  ): Promise<ProviderSecretState>;
  revealSecret(id: string, field: string, confirm: true): Promise<ProviderSecretRevealResponse>;
}

function invalidResponse(status: number, detail: string): AdminMutationError {
  return new AdminMutationError({
    code: "ADMIN_RESPONSE_INVALID",
    status,
    title: "后台服务返回了无法识别的数据",
    detail,
    degraded: [],
  });
}

function withExpectedVersion(path: string, expectedVersion: number): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}expectedVersion=${encodeURIComponent(String(expectedVersion))}`;
}

function providerPath(id: string): string {
  return `/v1/admin/providers/${encodeURIComponent(id)}`;
}

function groupPath(group: ProviderGroup): string {
  return `/v1/admin/provider-groups/${encodeURIComponent(group)}`;
}

function secretPath(id: string, field: string): string {
  return `${providerPath(id)}/secrets/${encodeURIComponent(field)}`;
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const response = await fetchImpl(path, {
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
    throw adminSettingsErrorFromResponse(response.status, payload, response.headers);
  }
  if (payload === null) {
    throw invalidResponse(response.status, "后台服务没有返回可读取的数据。");
  }

  try {
    return schema.parse(payload);
  } catch (error) {
    throw invalidResponse(
      response.status,
      error instanceof Error ? error.message : "无法读取后台服务返回的数据。",
    );
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Same-origin client for the catalog-driven Provider Admin API.
 *
 * It intentionally accepts a fetch implementation so tests can assert the
 * write-only secret paths without mounting the Admin app.
 */
export function createProviderSettingsApi(fetchImpl: typeof fetch = fetch): ProviderSettingsApi {
  return {
    catalog: () =>
      requestJson(
        fetchImpl,
        "/v1/admin/provider-catalog",
        { method: "GET" },
        ProviderCatalogSchema,
      ),
    group: (group) =>
      requestJson(fetchImpl, groupPath(group), { method: "GET" }, ProviderGroupResponseSchema),
    updatePolicy: (group, input) =>
      requestJson(
        fetchImpl,
        groupPath(group),
        { method: "PATCH", body: jsonBody(input) },
        ProviderGroupResponseSchema,
      ),
    reorder: (group, ids, expectedGroupVersion) =>
      requestJson(
        fetchImpl,
        `${groupPath(group)}/order`,
        { method: "PUT", body: jsonBody({ ids, expectedGroupVersion }) },
        ProviderGroupResponseSchema,
      ),
    create: (input) =>
      requestJson(
        fetchImpl,
        "/v1/admin/providers",
        { method: "POST", body: jsonBody(input) },
        ProviderConnectionSchema,
      ),
    update: (id, input) =>
      requestJson(
        fetchImpl,
        providerPath(id),
        { method: "PATCH", body: jsonBody(input) },
        ProviderConnectionSchema,
      ),
    remove: async (id, expectedVersion) => {
      await requestJson(
        fetchImpl,
        withExpectedVersion(providerPath(id), expectedVersion),
        { method: "DELETE" },
        ProviderDeleteResponseSchema,
      );
    },
    probe: (id, expectedVersion) =>
      requestJson(
        fetchImpl,
        withExpectedVersion(`${providerPath(id)}/probe`, expectedVersion),
        { method: "POST" },
        ProviderProbeResponseSchema,
      ),
    probeDraft: (input) =>
      requestJson(
        fetchImpl,
        "/v1/admin/providers/probe",
        { method: "POST", body: jsonBody(input) },
        ProviderProbeResponseSchema,
      ),
    discoverModels: (input, options) =>
      requestJson(
        fetchImpl,
        "/v1/admin/provider-models/discover",
        { method: "POST", body: jsonBody(input), signal: options?.signal },
        ProviderModelDiscoveryResponseSchema,
      ),
    refreshModels: (id, expectedVersion, options) =>
      requestJson(
        fetchImpl,
        withExpectedVersion(`${providerPath(id)}/models/refresh`, expectedVersion),
        { method: "POST", signal: options?.signal },
        ProviderModelDiscoveryResponseSchema,
      ),
    updateModel: (id, modelId, input) =>
      requestJson(
        fetchImpl,
        `${providerPath(id)}/models/${encodeURIComponent(modelId)}`,
        { method: "PATCH", body: jsonBody(input) },
        ProviderModelSchema,
      ),
    replaceSecret: (id, field, input) =>
      requestJson(
        fetchImpl,
        secretPath(id, field),
        { method: "PUT", body: jsonBody(input) },
        ProviderSecretStateSchema,
      ),
    revealSecret: (id, field, confirm) =>
      requestJson(
        fetchImpl,
        `${secretPath(id, field)}/reveal`,
        { method: "POST", body: jsonBody({ confirm }) },
        ProviderSecretRevealResponseSchema,
      ),
  };
}

export const providerSettingsApi: ProviderSettingsApi = createProviderSettingsApi();
