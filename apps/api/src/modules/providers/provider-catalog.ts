import type {
  AiReasoningEffort,
  ProviderAdapterDescriptor,
  ProviderCatalog,
  ProviderConfigField,
  ProviderGroup,
  ProviderPreset as ProviderPresetContract,
  ProviderSecretFieldDescriptor,
} from "@roamlog/contracts";
import { AI_REASONING_EFFORTS } from "@roamlog/contracts";

import {
  type ProviderAdapter,
  type ProviderAdapterDefinition,
  type ProviderPresetDefinition,
  type ProviderSecretField,
  anthropicMessagesConfigSchema,
  geoapifyProviderConfigSchema,
  openAiCompatibleConfigSchema,
  openAiResponsesConfigSchema,
  photonProviderConfigSchema,
  resendProviderConfigSchema,
  s3ProviderConfigSchema,
  smtpProviderConfigSchema,
  tencentProviderConfigSchema,
} from "./provider-contracts.js";
import { providerProblem } from "./provider-errors.js";

const GROUP_LABELS: Readonly<Record<ProviderGroup, string>> = Object.freeze({
  ai: "AI 服务",
  places: "地图服务",
  mail: "发信服务",
  storage: "存储服务",
});

const GROUP_ROUTING_MODES: Readonly<Record<ProviderGroup, readonly string[]>> = Object.freeze({
  ai: ["priority"],
  places: ["merge", "priority_failover"],
  mail: ["single"],
  storage: ["single"],
});

const REASONING_EFFORT_LABELS: Readonly<Record<AiReasoningEffort, string>> = Object.freeze({
  none: "无",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
});

function field(
  key: string,
  type: ProviderConfigField["type"],
  label: string,
  required: boolean,
  options: Partial<ProviderConfigField> = {},
): ProviderConfigField {
  return {
    key,
    type,
    label,
    required,
    ...options,
  };
}

function option(value: string, label: string): { value: string; label: string } {
  return { value, label };
}

const AI_CONFIG_FIELDS: readonly ProviderConfigField[] = [
  field("baseUrl", "url", "Base URL", true, {
    help: "完整 API 根地址，例如 https://api.openai.com/v1。",
  }),
  field("defaultModel", "model", "默认模型", false),
  field("timeoutMs", "integer", "超时（毫秒）", false, {
    min: 1_000,
    max: 120_000,
    default: 60_000,
  }),
  field("maxOutputTokens", "integer", "最大输出 tokens", false, {
    min: 256,
    max: 65_536,
    default: 4_096,
  }),
  field("reasoningEffort", "select", "推理强度", false, {
    options: AI_REASONING_EFFORTS.map((value) => option(value, REASONING_EFFORT_LABELS[value])),
  }),
];

function placesConfigFields(
  timeoutDefaultMs: number,
  options: { readonly includeDailyQuota?: boolean } = {},
): readonly ProviderConfigField[] {
  return [
    field("baseUrl", "url", "Base URL", true),
    field("timeoutMs", "integer", "超时（毫秒）", false, {
      min: 1_000,
      max: 30_000,
      default: timeoutDefaultMs,
    }),
    field("regions", "multi-select", "适用区域", true, {
      options: [option("cn", "中国"), option("global", "全球")],
    }),
    ...(options.includeDailyQuota === false
      ? []
      : [
          field("dailyQuota", "integer", "每日配额", false, {
            min: 0,
            max: 1_000_000,
            default: 0,
          }),
        ]),
    field("cacheTtlSeconds", "integer", "缓存秒数", false, {
      min: 60,
      max: 86_400,
      default: 900,
    }),
  ];
}

const TENCENT_CONFIG_FIELDS = placesConfigFields(2_000);
const GEOAPIFY_CONFIG_FIELDS = placesConfigFields(5_000);
const PHOTON_CONFIG_FIELDS = placesConfigFields(2_500, { includeDailyQuota: false });

const MAIL_FROM_FIELD = field("from", "text", "发件地址", true);
const SMTP_FIELDS: readonly ProviderConfigField[] = [
  MAIL_FROM_FIELD,
  field("host", "text", "SMTP 主机", true),
  field("port", "integer", "端口", false, { min: 1, max: 65_535, default: 587 }),
  field("secure", "boolean", "TLS 直连", false, { default: false }),
  field("user", "text", "SMTP 用户名", false),
];

const S3_FIELDS: readonly ProviderConfigField[] = [
  field("endpoint", "url", "S3 Endpoint", true),
  field("publicEndpoint", "url", "公开访问 Endpoint", false),
  field("bucket", "text", "Bucket", true),
  field("region", "text", "Region", false, { default: "us-east-1" }),
  field("forcePathStyle", "boolean", "Force path style", false, { default: true }),
];

const AI_SECRET_FIELDS: readonly ProviderSecretFieldDescriptor[] = [
  {
    key: "apiKey",
    label: "API Key",
    required: false,
  },
];

const MAP_API_KEY_FIELDS: readonly ProviderSecretFieldDescriptor[] = [
  {
    key: "apiKey",
    label: "API Key",
    required: true,
  },
];

const PROVIDER_ADAPTER_DEFINITIONS: readonly ProviderAdapterDefinition[] = Object.freeze([
  {
    adapter: "openai-chat",
    group: "ai",
    label: "OpenAI Chat Completions",
    presets: [
      {
        preset: "openai",
        adapter: "openai-chat",
        label: "OpenAI",
        defaultBaseUrl: "https://api.openai.com/v1",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
      {
        preset: "deepseek",
        adapter: "openai-chat",
        label: "DeepSeek",
        defaultBaseUrl: "https://api.deepseek.com/v1",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
      {
        preset: "openrouter",
        adapter: "openai-chat",
        label: "OpenRouter",
        defaultBaseUrl: "https://openrouter.ai/api/v1",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
      {
        preset: "groq",
        adapter: "openai-chat",
        label: "Groq",
        defaultBaseUrl: "https://api.groq.com/openai/v1",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
      {
        preset: "together",
        adapter: "openai-chat",
        label: "Together AI",
        defaultBaseUrl: "https://api.together.xyz/v1",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
      {
        preset: "gemini-openai",
        adapter: "openai-chat",
        label: "Gemini（OpenAI 兼容）",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
      {
        preset: "custom-openai-compatible",
        adapter: "openai-chat",
        label: "自定义 OpenAI 兼容",
        defaultBaseUrl: null,
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
    ],
    configSchema: openAiCompatibleConfigSchema,
    configFields: AI_CONFIG_FIELDS,
    secretFields: AI_SECRET_FIELDS,
    capabilities: ["model_discovery", "probe", "priority"],
  },
  {
    adapter: "openai-responses",
    group: "ai",
    label: "OpenAI Responses",
    presets: [
      {
        preset: "openai-responses",
        adapter: "openai-responses",
        label: "OpenAI Responses",
        defaultBaseUrl: "https://api.openai.com/v1",
        modelDiscovery: "openai-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "bearer",
      },
    ],
    configSchema: openAiResponsesConfigSchema,
    configFields: AI_CONFIG_FIELDS,
    secretFields: AI_SECRET_FIELDS,
    capabilities: ["model_discovery", "probe", "priority"],
  },
  {
    adapter: "anthropic-messages",
    group: "ai",
    label: "Anthropic Messages",
    presets: [
      {
        preset: "anthropic",
        adapter: "anthropic-messages",
        label: "Anthropic",
        defaultBaseUrl: "https://api.anthropic.com/v1",
        modelDiscovery: "anthropic-models",
        manualModelAllowed: true,
        discoveryPath: "/models",
        authHeader: "anthropic",
      },
    ],
    configSchema: anthropicMessagesConfigSchema,
    configFields: AI_CONFIG_FIELDS,
    secretFields: AI_SECRET_FIELDS,
    capabilities: ["model_discovery", "probe", "priority"],
  },
  {
    adapter: "tencent",
    group: "places",
    label: "腾讯位置服务",
    presets: [
      {
        preset: "tencent",
        adapter: "tencent",
        label: "腾讯地图",
        defaultBaseUrl: "https://apis.map.qq.com/ws",
        modelDiscovery: "manual-only",
        manualModelAllowed: false,
        discoveryPath: null,
        authHeader: "none",
      },
    ],
    configSchema: tencentProviderConfigSchema,
    configFields: TENCENT_CONFIG_FIELDS,
    secretFields: MAP_API_KEY_FIELDS,
    capabilities: ["probe", "merge", "priority"],
  },
  {
    adapter: "geoapify",
    group: "places",
    label: "Geoapify",
    presets: [
      {
        preset: "geoapify",
        adapter: "geoapify",
        label: "Geoapify",
        defaultBaseUrl: "https://api.geoapify.com/v1/geocode/autocomplete",
        modelDiscovery: "manual-only",
        manualModelAllowed: false,
        discoveryPath: null,
        authHeader: "none",
      },
    ],
    configSchema: geoapifyProviderConfigSchema,
    configFields: GEOAPIFY_CONFIG_FIELDS,
    secretFields: MAP_API_KEY_FIELDS,
    capabilities: ["probe", "merge", "priority"],
  },
  {
    adapter: "photon",
    group: "places",
    label: "Photon",
    presets: [
      {
        preset: "photon",
        adapter: "photon",
        label: "Photon",
        defaultBaseUrl: "https://photon.komoot.io/api",
        modelDiscovery: "manual-only",
        manualModelAllowed: false,
        discoveryPath: null,
        authHeader: "none",
      },
    ],
    configSchema: photonProviderConfigSchema,
    configFields: PHOTON_CONFIG_FIELDS,
    secretFields: [],
    capabilities: ["probe", "merge", "priority"],
  },
  {
    adapter: "resend",
    group: "mail",
    label: "Resend",
    presets: [
      {
        preset: "resend",
        adapter: "resend",
        label: "Resend",
        defaultBaseUrl: null,
        modelDiscovery: "manual-only",
        manualModelAllowed: false,
        discoveryPath: null,
        authHeader: "none",
      },
    ],
    configSchema: resendProviderConfigSchema,
    configFields: [MAIL_FROM_FIELD],
    secretFields: [{ key: "apiKey", label: "Resend API Key", required: true }],
    capabilities: ["probe"],
  },
  {
    adapter: "smtp",
    group: "mail",
    label: "SMTP",
    presets: [
      {
        preset: "smtp",
        adapter: "smtp",
        label: "SMTP",
        defaultBaseUrl: null,
        modelDiscovery: "manual-only",
        manualModelAllowed: false,
        discoveryPath: null,
        authHeader: "none",
      },
    ],
    configSchema: smtpProviderConfigSchema,
    configFields: SMTP_FIELDS,
    secretFields: [{ key: "password", label: "SMTP Password", required: false }],
    capabilities: ["probe"],
  },
  {
    adapter: "s3",
    group: "storage",
    label: "S3 兼容存储",
    presets: [
      {
        preset: "s3",
        adapter: "s3",
        label: "S3 兼容存储",
        defaultBaseUrl: null,
        modelDiscovery: "manual-only",
        manualModelAllowed: false,
        discoveryPath: null,
        authHeader: "none",
      },
    ],
    configSchema: s3ProviderConfigSchema,
    configFields: S3_FIELDS,
    secretFields: [
      { key: "accessKey", label: "Access Key", required: true },
      { key: "secretKey", label: "Secret Key", required: true },
    ],
    capabilities: ["probe"],
  },
]);

const ADAPTERS_BY_ID = new Map(
  PROVIDER_ADAPTER_DEFINITIONS.map((definition) => [definition.adapter, definition]),
);

export const PROVIDER_CATALOG_VERSION = 1;

export function providerAdapterDefinition(adapter: string): ProviderAdapterDefinition | undefined {
  return ADAPTERS_BY_ID.get(adapter as ProviderAdapter);
}

export function requireProviderAdapter(adapter: string): ProviderAdapterDefinition {
  const definition = providerAdapterDefinition(adapter);
  if (!definition) {
    throw providerProblem("PROVIDER_ADAPTER_UNSUPPORTED");
  }
  return definition;
}

export function providerPresetDefinition(
  adapter: string,
  preset: string,
): ProviderPresetDefinition {
  const definition = requireProviderAdapter(adapter);
  const match = definition.presets.find((entry) => entry.preset === preset);
  if (!match) {
    throw providerProblem(
      "PROVIDER_CONFIG_INVALID",
      "The selected provider preset does not belong to this adapter.",
    );
  }
  return match;
}

export function optionalProviderPresetDefinition(
  adapter: string,
  preset: string | null | undefined,
): ProviderPresetDefinition | undefined {
  if (preset === null || preset === undefined) {
    return undefined;
  }
  return providerPresetDefinition(adapter, preset);
}

export function parseProviderConfig(adapter: string, config: unknown): Record<string, unknown> {
  const definition = requireProviderAdapter(adapter);
  const parsed = definition.configSchema.safeParse(config);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 20).map((issue) => ({
      field: issue.path.map(String).join(".") || undefined,
      code: "INVALID_PROVIDER_CONFIG",
      message: issue.message,
    }));
    throw providerProblem(
      "PROVIDER_CONFIG_INVALID",
      "The provider configuration is invalid.",
      errors,
    );
  }
  return parsed.data as Record<string, unknown>;
}

function cloneDefault(value: ProviderConfigField["default"]): ProviderConfigField["default"] {
  return value === undefined ? undefined : structuredClone(value);
}

function descriptorFor(definition: ProviderAdapterDefinition): ProviderAdapterDescriptor {
  return {
    adapter: definition.adapter,
    label: definition.label,
    capabilities: [...definition.capabilities],
    configFields: definition.configFields.map((entryValue) => ({
      ...entryValue,
      ...(entryValue.options
        ? { options: entryValue.options.map((entryOption) => ({ ...entryOption })) }
        : {}),
      ...(entryValue.default === undefined ? {} : { default: cloneDefault(entryValue.default) }),
    })),
    secretFields: definition.secretFields.map((entryValue) => ({ ...entryValue })),
    presets: definition.presets.map((entry): ProviderPresetContract => ({
      preset: entry.preset,
      label: entry.label,
      defaultBaseUrl: entry.defaultBaseUrl,
    })),
  };
}

export function providerCatalogResponse(): ProviderCatalog {
  return {
    version: PROVIDER_CATALOG_VERSION,
    groups: (["ai", "places", "mail", "storage"] as const).map((group) => ({
      group,
      label: GROUP_LABELS[group],
      routingModes: [
        ...GROUP_ROUTING_MODES[group],
      ] as ProviderCatalog["groups"][number]["routingModes"],
      adapters: PROVIDER_ADAPTER_DEFINITIONS.filter((entry) => entry.group === group).map(
        descriptorFor,
      ),
    })),
  };
}

export function providerAdapterForGroup(
  group: ProviderGroup,
): readonly ProviderAdapterDefinition[] {
  return PROVIDER_ADAPTER_DEFINITIONS.filter((definition) => definition.group === group);
}

export function providerSecretField(
  adapter: string,
  fieldName: string,
): ProviderSecretField | undefined {
  return requireProviderAdapter(adapter).secretFields.find((entry) => entry.key === fieldName);
}
