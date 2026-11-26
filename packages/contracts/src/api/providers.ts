import { z } from "zod";

import { IsoTimestampSchema, JsonObjectSchema, UuidV7Schema } from "../common/ids";
import { AiReasoningEffortSchema } from "./ai";

export const PROVIDER_GROUPS = ["ai", "places", "mail", "storage"] as const;
export const ProviderGroupSchema = z.enum(PROVIDER_GROUPS);
export type ProviderGroup = z.infer<typeof ProviderGroupSchema>;

export const PROVIDER_ROUTING_MODES = ["priority", "merge", "priority_failover", "single"] as const;
export const ProviderRoutingModeSchema = z.enum(PROVIDER_ROUTING_MODES);
export type ProviderRoutingMode = z.infer<typeof ProviderRoutingModeSchema>;

export const PROVIDER_HEALTH_STATUSES = ["unknown", "healthy", "degraded", "unhealthy"] as const;
export const ProviderHealthStatusSchema = z.enum(PROVIDER_HEALTH_STATUSES);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

export const ProviderHealthSchema = z
  .object({
    status: ProviderHealthStatusSchema,
    lastCheckedAt: IsoTimestampSchema.nullable(),
    lastErrorCode: z.string().max(80).nullable(),
    cooldownUntil: IsoTimestampSchema.nullable(),
  })
  .strict();
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ProviderSecretFieldSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/)
  .describe("Provider secret field name.");
export type ProviderSecretField = z.infer<typeof ProviderSecretFieldSchema>;

export const ProviderSecretStateSchema = z
  .object({
    field: ProviderSecretFieldSchema,
    hasValue: z.boolean(),
    last4: z.string().max(8).nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export type ProviderSecretState = z.infer<typeof ProviderSecretStateSchema>;

export const ProviderConfigFieldTypeSchema = z.enum([
  "text",
  "url",
  "integer",
  "number",
  "boolean",
  "select",
  "multi-select",
  "model",
]);
export type ProviderConfigFieldType = z.infer<typeof ProviderConfigFieldTypeSchema>;

export const ProviderConfigFieldOptionSchema = z
  .object({
    value: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
  })
  .strict();
export type ProviderConfigFieldOption = z.infer<typeof ProviderConfigFieldOptionSchema>;

export const ProviderConfigFieldDefaultSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
export type ProviderConfigFieldDefault = z.infer<typeof ProviderConfigFieldDefaultSchema>;

export const ProviderConfigFieldSchema = z
  .object({
    key: z.string().min(1).max(80),
    type: ProviderConfigFieldTypeSchema,
    label: z.string().min(1).max(120),
    help: z.string().max(500).optional(),
    required: z.boolean(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    options: z.array(ProviderConfigFieldOptionSchema).max(100).optional(),
    default: ProviderConfigFieldDefaultSchema.optional(),
  })
  .strict();
export type ProviderConfigField = z.infer<typeof ProviderConfigFieldSchema>;

export const ProviderSecretFieldDescriptorSchema = z
  .object({
    key: ProviderSecretFieldSchema,
    label: z.string().min(1).max(120),
    required: z.boolean(),
  })
  .strict();
export type ProviderSecretFieldDescriptor = z.infer<typeof ProviderSecretFieldDescriptorSchema>;

export const ProviderPresetSchema = z
  .object({
    preset: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    defaultBaseUrl: z.url().max(2_048).nullable(),
  })
  .strict();
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

export const ProviderAdapterDescriptorSchema = z
  .object({
    adapter: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    capabilities: z.array(z.string().min(1).max(80)).max(40),
    configFields: z.array(ProviderConfigFieldSchema).max(80),
    secretFields: z.array(ProviderSecretFieldDescriptorSchema).max(40),
    presets: z.array(ProviderPresetSchema).max(40),
  })
  .strict();
export type ProviderAdapterDescriptor = z.infer<typeof ProviderAdapterDescriptorSchema>;

export const ProviderCatalogGroupSchema = z
  .object({
    group: ProviderGroupSchema,
    label: z.string().min(1).max(80),
    routingModes: z.array(ProviderRoutingModeSchema).min(1),
    adapters: z.array(ProviderAdapterDescriptorSchema).min(1),
  })
  .strict();
export type ProviderCatalogGroup = z.infer<typeof ProviderCatalogGroupSchema>;

export const ProviderCatalogSchema = z
  .object({
    version: z.number().int().positive(),
    groups: z.array(ProviderCatalogGroupSchema).min(1),
  })
  .strict();
export type ProviderCatalog = z.infer<typeof ProviderCatalogSchema>;

export const ProviderConnectionSchema = z
  .object({
    id: UuidV7Schema,
    group: ProviderGroupSchema,
    adapter: z.string().min(1).max(40),
    preset: z.string().min(1).max(40).nullable(),
    label: z.string().min(1).max(80),
    enabled: z.boolean(),
    priority: z.number().int().min(0),
    config: JsonObjectSchema,
    version: z.number().int().positive(),
    secrets: z.array(ProviderSecretStateSchema),
    health: ProviderHealthSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export const ProviderGroupPolicySchema = z
  .object({
    group: ProviderGroupSchema,
    routingMode: ProviderRoutingModeSchema,
    maxAttempts: z.number().int().min(1).max(5),
    cooldownSeconds: z.number().int().min(0).max(3_600),
    version: z.number().int().positive(),
  })
  .strict();
export type ProviderGroupPolicy = z.infer<typeof ProviderGroupPolicySchema>;

export const ProviderGroupResponseSchema = z
  .object({
    group: ProviderGroupSchema,
    label: z.string().min(1).max(80),
    routingMode: ProviderRoutingModeSchema,
    maxAttempts: z.number().int().min(1).max(5),
    cooldownSeconds: z.number().int().min(0).max(3_600),
    version: z.number().int().positive(),
    providers: z.array(ProviderConnectionSchema),
  })
  .strict();
export type ProviderGroupResponse = z.infer<typeof ProviderGroupResponseSchema>;

export const ProviderModelCapabilitiesSchema = z
  .object({
    vision: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tools: z.boolean().optional(),
    /** Capability tiers copied from the model catalog, not operator input. */
    reasoningEfforts: z.array(AiReasoningEffortSchema).max(8).optional(),
    defaultReasoningEffort: AiReasoningEffortSchema.optional(),
  })
  .strict();
export type ProviderModelCapabilities = z.infer<typeof ProviderModelCapabilitiesSchema>;

export const ProviderModelSchema = z
  .object({
    id: UuidV7Schema,
    providerId: UuidV7Schema,
    modelId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(160),
    ownedBy: z.string().max(80).nullable(),
    enabled: z.boolean(),
    isDefault: z.boolean(),
    capabilities: ProviderModelCapabilitiesSchema,
    discoveredAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderDiscoveredModelSchema = z
  .object({
    modelId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(160),
    ownedBy: z.string().max(80).nullable(),
    capabilities: ProviderModelCapabilitiesSchema,
  })
  .strict();
export type ProviderDiscoveredModel = z.infer<typeof ProviderDiscoveredModelSchema>;

export const ProviderModelDiscoveryResponseSchema = z
  .object({
    models: z.array(ProviderDiscoveredModelSchema).max(200),
    fetchedAt: IsoTimestampSchema,
    manualEntryRequired: z.boolean(),
  })
  .strict();
export type ProviderModelDiscoveryResponse = z.infer<typeof ProviderModelDiscoveryResponseSchema>;

export const ProviderProbeCheckSchema = z
  .object({
    name: z.string().min(1).max(80),
    status: z.enum(["pass", "fail", "skip"]),
    latencyMs: z.number().int().nonnegative().nullable(),
    code: z.string().max(80).nullable(),
    message: z.string().max(500).nullable(),
  })
  .strict();
export type ProviderProbeCheck = z.infer<typeof ProviderProbeCheckSchema>;

export const ProviderProbeResponseSchema = z
  .object({
    ok: z.boolean(),
    providerId: UuidV7Schema.nullable(),
    testedAt: IsoTimestampSchema,
    checks: z.array(ProviderProbeCheckSchema),
  })
  .strict();
export type ProviderProbeResponse = z.infer<typeof ProviderProbeResponseSchema>;

export const ProviderSecretRevealRequestSchema = z
  .object({
    confirm: z.literal(true),
  })
  .strict();
export type ProviderSecretRevealRequest = z.infer<typeof ProviderSecretRevealRequestSchema>;

export const ProviderSecretRevealResponseSchema = z
  .object({
    field: ProviderSecretFieldSchema,
    value: z.string(),
    expiresAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type ProviderSecretRevealResponse = z.infer<typeof ProviderSecretRevealResponseSchema>;

export const ProviderGroupParamsSchema = z
  .object({
    group: ProviderGroupSchema,
  })
  .strict();
export type ProviderGroupParams = z.infer<typeof ProviderGroupParamsSchema>;

export const ProviderIdParamsSchema = z
  .object({
    id: UuidV7Schema,
  })
  .strict();
export type ProviderIdParams = z.infer<typeof ProviderIdParamsSchema>;

export const ProviderSecretParamsSchema = z
  .object({
    id: UuidV7Schema,
    field: ProviderSecretFieldSchema,
  })
  .strict();
export type ProviderSecretParams = z.infer<typeof ProviderSecretParamsSchema>;

export const ProviderModelParamsSchema = z
  .object({
    id: UuidV7Schema,
    modelId: z.string().min(1).max(200),
  })
  .strict();
export type ProviderModelParams = z.infer<typeof ProviderModelParamsSchema>;

export const ProviderVersionQuerySchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
  })
  .strict();
export type ProviderVersionQuery = z.infer<typeof ProviderVersionQuerySchema>;

export const CreateProviderRequestSchema = z
  .object({
    group: ProviderGroupSchema,
    adapter: z.string().min(1).max(40),
    preset: z.string().min(1).max(40).nullable().optional(),
    label: z.string().min(1).max(80),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
    config: JsonObjectSchema,
    secrets: z.record(ProviderSecretFieldSchema, z.string().min(1).max(4_096)).optional(),
    expectedGroupVersion: z.number().int().positive().optional(),
  })
  .strict();
export type CreateProviderRequest = z.infer<typeof CreateProviderRequestSchema>;

export const UpdateProviderRequestSchema = z
  .object({
    adapter: z.string().min(1).max(40).optional(),
    preset: z.string().min(1).max(40).nullable().optional(),
    label: z.string().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
    config: JsonObjectSchema.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type UpdateProviderRequest = z.infer<typeof UpdateProviderRequestSchema>;

export const ReorderProvidersRequestSchema = z
  .object({
    ids: z.array(UuidV7Schema).min(1).max(100),
    expectedGroupVersion: z.number().int().positive(),
  })
  .strict();
export type ReorderProvidersRequest = z.infer<typeof ReorderProvidersRequestSchema>;

export const UpdateProviderPolicyRequestSchema = z
  .object({
    routingMode: ProviderRoutingModeSchema,
    maxAttempts: z.number().int().min(1).max(5),
    cooldownSeconds: z.number().int().min(0).max(3_600),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type UpdateProviderPolicyRequest = z.infer<typeof UpdateProviderPolicyRequestSchema>;

export const ProviderDraftProbeRequestSchema = z
  .object({
    group: ProviderGroupSchema,
    adapter: z.string().min(1).max(40),
    preset: z.string().min(1).max(40).nullable().optional(),
    config: JsonObjectSchema,
    secrets: z.record(ProviderSecretFieldSchema, z.string().min(1).max(4_096)).optional(),
  })
  .strict();
export type ProviderDraftProbeRequest = z.infer<typeof ProviderDraftProbeRequestSchema>;

export const ProviderModelDiscoveryRequestSchema = z
  .object({
    providerId: UuidV7Schema.optional(),
    group: ProviderGroupSchema,
    adapter: z.string().min(1).max(40),
    preset: z.string().min(1).max(40).nullable().optional(),
    baseUrl: z.url().max(2_048).optional(),
    apiKey: z.string().min(1).max(4_096).optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
export type ProviderModelDiscoveryRequest = z.infer<typeof ProviderModelDiscoveryRequestSchema>;

export const UpdateProviderModelRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    capabilities: ProviderModelCapabilitiesSchema.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type UpdateProviderModelRequest = z.infer<typeof UpdateProviderModelRequestSchema>;

export const ReplaceProviderSecretRequestSchema = z
  .object({
    value: z.string().min(1).max(4_096),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type ReplaceProviderSecretRequest = z.infer<typeof ReplaceProviderSecretRequestSchema>;
export type ReplaceProviderSecretResponse = ProviderSecretState;

export const ProviderDeleteResponseSchema = z
  .object({
    message: z.string().min(1).max(500),
  })
  .strict();
export type ProviderDeleteResponse = z.infer<typeof ProviderDeleteResponseSchema>;

export const ProviderProblemCodeSchema = z.enum([
  "PROVIDER_GROUP_NOT_FOUND",
  "PROVIDER_NOT_FOUND",
  "PROVIDER_VERSION_CONFLICT",
  "PROVIDER_ORDER_CONFLICT",
  "PROVIDER_ADAPTER_UNSUPPORTED",
  "PROVIDER_ACTIVE_CONFLICT",
  "PROVIDER_CONFIG_INVALID",
  "PROVIDER_SECRET_FIELD_UNKNOWN",
  "PROVIDER_SECRETS_UNAVAILABLE",
  "PROVIDER_PROBE_FAILED",
  "PROVIDER_PROBE_TIMEOUT",
  "PROVIDER_MODELS_DISCOVERY_FAILED",
  "PROVIDER_MODELS_DISCOVERY_TIMEOUT",
  "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
  "PROVIDER_MODELS_RESPONSE_TOO_LARGE",
  "PROVIDER_MODEL_DEFAULT_REQUIRED",
  "PROVIDER_EGRESS_BLOCKED",
  "PROVIDER_LIMIT_REACHED",
  "AI_MODEL_NOT_ALLOWED",
  "AI_PROVIDERS_UNAVAILABLE",
]);
export type ProviderProblemCode = z.infer<typeof ProviderProblemCodeSchema>;
