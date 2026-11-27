import { z } from "zod";

import { AiReasoningEffortSchema, type ProviderGroup } from "@roamlog/contracts";

export type ProviderAdapter =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "tencent"
  | "geoapify"
  | "photon"
  | "resend"
  | "smtp"
  | "s3";

export type ProviderCapability = "model_discovery" | "probe" | "priority" | "merge";

export type ProviderModelDiscovery = "openai-models" | "anthropic-models" | "manual-only";

export interface ProviderPresetDefinition {
  readonly preset: string;
  readonly adapter: ProviderAdapter;
  readonly label: string;
  readonly defaultBaseUrl: string | null;
  readonly modelDiscovery: ProviderModelDiscovery;
  readonly manualModelAllowed: boolean;
  readonly discoveryPath: string | null;
  readonly authHeader: "bearer" | "anthropic" | "none";
}

export interface ProviderSecretField {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
}

export interface ProviderAdapterDefinition {
  readonly adapter: ProviderAdapter;
  readonly group: ProviderGroup;
  readonly label: string;
  readonly presets: readonly ProviderPresetDefinition[];
  readonly configSchema: z.ZodType<Record<string, unknown>>;
  readonly configFields: readonly import("@roamlog/contracts").ProviderConfigField[];
  readonly secretFields: readonly ProviderSecretField[];
  readonly capabilities: readonly ProviderCapability[];
}

const url = z.url().max(2_048);
const modelId = z.string().min(1).max(200);
const timeoutMs = z.number().int().min(1_000).max(120_000);
const mapTimeoutMs = z.number().int().min(1_000).max(30_000);
const maxOutputTokens = z.number().int().min(256).max(65_536);
const dailyQuota = z.number().int().min(0).max(1_000_000);
const cacheTtlSeconds = z.number().int().min(60).max(86_400);
const mailFrom = z
  .string()
  .min(3)
  .max(320)
  .refine((value) => value.includes("@") && !/[\r\n]/u.test(value), {
    message: "Must be an email address, for example Roamlog <no-reply@example.com>.",
  });
const regions = z
  .array(z.enum(["cn", "global"]))
  .min(1)
  .max(2)
  .default(["global"]);

export const aiProviderConfigSchema = z
  .object({
    baseUrl: url,
    defaultModel: modelId.optional(),
    timeoutMs: timeoutMs.default(60_000),
    maxOutputTokens: maxOutputTokens.default(4_096),
    reasoningEffort: AiReasoningEffortSchema.optional(),
  })
  .strict();

export const openAiCompatibleConfigSchema = aiProviderConfigSchema;
export const anthropicMessagesConfigSchema = aiProviderConfigSchema;
export const openAiResponsesConfigSchema = aiProviderConfigSchema;

export const tencentProviderConfigSchema = z
  .object({
    baseUrl: url,
    timeoutMs: mapTimeoutMs.default(2_000),
    regions: regions.default(["cn"]),
    dailyQuota: dailyQuota.default(0),
    cacheTtlSeconds: cacheTtlSeconds.default(900),
  })
  .strict();

export const geoapifyProviderConfigSchema = z
  .object({
    baseUrl: url,
    // Geoapify autocomplete regularly replies around 2.8 s for Han queries.
    // The old 2 s form default aborted those real responses before they could
    // be normalized and merged.
    timeoutMs: mapTimeoutMs.default(5_000),
    regions: regions.default(["global"]),
    dailyQuota: dailyQuota.default(0),
    cacheTtlSeconds: cacheTtlSeconds.default(900),
  })
  .strict();

export const photonProviderConfigSchema = z
  .object({
    baseUrl: url,
    timeoutMs: mapTimeoutMs.default(2_500),
    regions: regions.default(["global"]),
    cacheTtlSeconds: cacheTtlSeconds.default(900),
  })
  .strict();

export const resendProviderConfigSchema = z
  .object({
    from: mailFrom,
  })
  .strict();

export const smtpProviderConfigSchema = z
  .object({
    from: mailFrom,
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535).default(587),
    secure: z.boolean().default(false),
    user: z.string().max(320).optional(),
  })
  .strict();

export const s3ProviderConfigSchema = z
  .object({
    endpoint: url,
    publicEndpoint: url.optional(),
    bucket: z.string().min(1).max(120),
    region: z.string().min(1).max(64).default("us-east-1"),
    forcePathStyle: z.boolean().default(true),
  })
  .strict();

export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;
export type TencentProviderConfig = z.infer<typeof tencentProviderConfigSchema>;
export type GeoapifyProviderConfig = z.infer<typeof geoapifyProviderConfigSchema>;
export type PhotonProviderConfig = z.infer<typeof photonProviderConfigSchema>;
export type ResendProviderConfig = z.infer<typeof resendProviderConfigSchema>;
export type SmtpProviderConfig = z.infer<typeof smtpProviderConfigSchema>;
export type S3ProviderConfig = z.infer<typeof s3ProviderConfigSchema>;
