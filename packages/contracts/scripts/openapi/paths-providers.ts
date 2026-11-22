import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

const versionErrors = [400, 401, 403, 404, 409, 422, 429, 500, 503];
const probeErrors = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504];

export function registerProviderPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/provider-catalog",
    operationId: "listProviderCatalog",
    tag: "Admin",
    summary: "List provider adapters, presets, and typed form fields",
    description:
      "Returns the code-owned provider catalog used by the Admin UI. It contains no credentials or saved values.",
    response: c.ProviderCatalogSchema,
    errors: [401, 403, 500, 503],
  });

  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/provider-groups/{group}",
    operationId: "getProviderGroup",
    tag: "Admin",
    summary: "Get a provider group and its ordered providers",
    params: c.ProviderGroupParamsSchema,
    response: c.ProviderGroupResponseSchema,
    errors: [400, 401, 403, 404, 500, 503],
  });

  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/provider-groups/{group}",
    operationId: "updateProviderGroupPolicy",
    tag: "Admin",
    summary: "Update a provider group routing policy",
    params: c.ProviderGroupParamsSchema,
    body: c.UpdateProviderPolicyRequestSchema,
    response: c.ProviderGroupResponseSchema,
    errors: versionErrors,
  });

  registerOperation(registry, {
    method: "put",
    path: "/v1/admin/provider-groups/{group}/order",
    operationId: "reorderProviders",
    tag: "Admin",
    summary: "Replace provider priority order",
    params: c.ProviderGroupParamsSchema,
    body: c.ReorderProvidersRequestSchema,
    response: c.ProviderGroupResponseSchema,
    errors: versionErrors,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/providers",
    operationId: "createProvider",
    tag: "Admin",
    summary: "Create a provider connection",
    description:
      "Initial secret fields may be supplied once in the create request and are encrypted in the same transaction as the provider.",
    body: c.CreateProviderRequestSchema,
    response: c.ProviderConnectionSchema,
    errors: versionErrors,
  });

  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/providers/{id}",
    operationId: "updateProvider",
    tag: "Admin",
    summary: "Update a provider connection",
    description:
      "Secret fields are not accepted here. Use the dedicated secret replacement endpoint.",
    params: c.ProviderIdParamsSchema,
    body: c.UpdateProviderRequestSchema,
    response: c.ProviderConnectionSchema,
    errors: versionErrors,
  });

  registerOperation(registry, {
    method: "delete",
    path: "/v1/admin/providers/{id}",
    operationId: "deleteProvider",
    tag: "Admin",
    summary: "Soft-delete a provider connection",
    params: c.ProviderIdParamsSchema,
    query: c.ProviderVersionQuerySchema,
    response: c.ProviderDeleteResponseSchema,
    errors: [400, 401, 403, 404, 409, 500, 503],
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/providers/{id}/probe",
    operationId: "probeProvider",
    tag: "Admin",
    summary: "Test a saved provider connection",
    params: c.ProviderIdParamsSchema,
    query: c.ProviderVersionQuerySchema,
    status: 200,
    response: c.ProviderProbeResponseSchema,
    errors: probeErrors,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/providers/probe",
    operationId: "probeProviderDraft",
    tag: "Admin",
    summary: "Test a provider draft without saving it",
    status: 200,
    body: c.ProviderDraftProbeRequestSchema,
    response: c.ProviderProbeResponseSchema,
    errors: probeErrors,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/provider-models/discover",
    operationId: "discoverProviderModels",
    tag: "Admin",
    summary: "Discover models from a saved or draft AI provider",
    description:
      "The API performs the upstream catalog request server-side. Credentials and upstream response bodies are never returned.",
    status: 200,
    body: c.ProviderModelDiscoveryRequestSchema,
    response: c.ProviderModelDiscoveryResponseSchema,
    errors: probeErrors,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/providers/{id}/models/refresh",
    operationId: "refreshProviderModels",
    tag: "Admin",
    summary: "Refresh the saved model catalog for an AI provider",
    status: 200,
    params: c.ProviderIdParamsSchema,
    query: c.ProviderVersionQuerySchema,
    response: c.ProviderModelDiscoveryResponseSchema,
    errors: probeErrors,
  });

  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/providers/{id}/models/{modelId}",
    operationId: "updateProviderModel",
    tag: "Admin",
    summary: "Enable, default, or change capabilities for a provider model",
    params: c.ProviderModelParamsSchema,
    body: c.UpdateProviderModelRequestSchema,
    response: c.ProviderModelSchema,
    errors: versionErrors,
  });

  registerOperation(registry, {
    method: "put",
    path: "/v1/admin/providers/{id}/secrets/{field}",
    operationId: "replaceProviderSecret",
    tag: "Admin",
    summary: "Atomically replace one provider secret",
    description:
      "The previous ciphertext moves to a private 24-hour history record for rollback and is never returned by the API.",
    status: 200,
    params: c.ProviderSecretParamsSchema,
    body: c.ReplaceProviderSecretRequestSchema,
    response: c.ProviderSecretStateSchema,
    errors: [400, 401, 403, 404, 409, 422, 429, 500, 503],
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/providers/{id}/secrets/{field}/reveal",
    operationId: "revealProviderSecret",
    tag: "Admin",
    summary: "Reveal one provider secret after explicit confirmation",
    description:
      "Requires super_admin, verified TOTP, and an explicit confirm body. The reveal is audited.",
    status: 200,
    params: c.ProviderSecretParamsSchema,
    body: c.ProviderSecretRevealRequestSchema,
    response: c.ProviderSecretRevealResponseSchema,
    errors: [400, 401, 403, 404, 409, 422, 429, 500],
  });
}
