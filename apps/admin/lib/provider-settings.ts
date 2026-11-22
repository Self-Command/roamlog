import type { ProviderCatalog, ProviderCatalogGroup, ProviderConnection } from "@roamlog/contracts";

import { AdminMutationError } from "./admin-api-error";
import type { ProviderUpdateInput } from "./provider-settings-api";

const HEALTH_LABELS = {
  unknown: "未验证",
  healthy: "正常",
  degraded: "降级",
  unhealthy: "异常",
} as const;

const MUTATION_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  SETTINGS_ENCRYPTION_UNAVAILABLE: "密钥存储未就绪，配置没有保存。请先修复服务端密钥配置后重试。",
  PROVIDER_SECRETS_UNAVAILABLE: "密钥服务不可用，密钥没有保存。请稍后重试。",
  PROVIDER_VERSION_CONFLICT: "这个服务商已被其他运营修改。请载入最新版本后再保存，当前草稿会保留。",
  PROVIDER_ORDER_CONFLICT: "服务商顺序已变化。请载入最新顺序，或保留当前顺序后重试。",
  PROVIDER_ACTIVE_CONFLICT: "邮件和存储服务只允许一个启用的服务商。请先停用当前实例后再启用。",
  PROVIDER_NOT_FOUND: "这个服务商已不存在，请刷新列表后重试。",
  PROVIDER_CONFIG_INVALID: "服务商配置有误，请检查必填字段后重试。",
  PROVIDER_EGRESS_BLOCKED: "该地址被安全策略拒绝，不能用于服务商请求。",
  PROVIDER_MODEL_DEFAULT_REQUIRED: "请为这个服务商选择一个默认模型。",
  PROVIDER_MODELS_DISCOVERY_TIMEOUT: "获取模型超时，请检查服务商网络后重试。",
  PROVIDER_MODELS_DISCOVERY_UNSUPPORTED: "这个服务商不支持自动模型目录，请手动填写模型 ID。",
  ADMIN_2FA_REQUIRED: "需要完成 TOTP 两步验证后才能修改服务商配置。",
  ADMIN_ACCESS_DENIED: "需要超级管理员权限才能修改服务商配置。",
});

function catalogGroup(
  catalog: ProviderCatalog,
  group: ProviderConnection["group"],
): ProviderCatalogGroup | null {
  return catalog.groups.find((entry) => entry.group === group) ?? null;
}

export function providerAdapterLabel(
  provider: ProviderConnection,
  catalog: ProviderCatalog,
): string {
  const group = catalogGroup(catalog, provider.group);
  const adapter = group?.adapters.find((entry) => entry.adapter === provider.adapter);
  return adapter?.label ?? provider.adapter;
}

export function providerPresetLabel(
  provider: ProviderConnection,
  catalog: ProviderCatalog,
): string {
  const group = catalogGroup(catalog, provider.group);
  const adapter = group?.adapters.find((entry) => entry.adapter === provider.adapter);
  if (!adapter) {
    return provider.adapter;
  }
  const preset = adapter.presets.find((entry) => entry.preset === provider.preset);
  return preset?.label ?? adapter.label;
}

export function providerStatusLabel(provider: ProviderConnection): string {
  if (!provider.enabled) {
    return "已停用";
  }
  return HEALTH_LABELS[provider.health.status] ?? HEALTH_LABELS.unknown;
}

/**
 * Returns a masked state for one secret field, or the first configured field
 * when the caller does not identify one. Plaintext is never part of the model.
 */
export function providerSecretLabel(provider: ProviderConnection, field?: string): string {
  const secret = field
    ? provider.secrets.find((entry) => entry.field === field)
    : provider.secrets.find((entry) => entry.hasValue);
  if (!secret?.hasValue) {
    return "未设置";
  }
  return secret.last4 ? `••••${secret.last4}` : "已设置";
}

export function providerOrderIds(providers: readonly ProviderConnection[]): string[] {
  return [...providers]
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .map((provider) => provider.id);
}

/**
 * Converts an editor draft into the PATCH body. Secret drafts are intentionally
 * dropped: replacement happens only through the dedicated secret endpoint.
 */
export function providerDraftPayload(
  input: ProviderUpdateInput & { secrets?: Record<string, string> },
): ProviderUpdateInput {
  const { secrets: _ignored, ...payload } = input;
  void _ignored;
  return payload;
}

export function providerMutationErrorMessage(error: unknown): string {
  if (error instanceof AdminMutationError) {
    const known = MUTATION_MESSAGES[error.failure.code];
    if (known) {
      return known;
    }
    if (error.failure.status === 401) {
      return "后台会话已过期，请重新登录后重试。";
    }
    if (error.failure.status === 403) {
      return "当前账号没有修改服务商配置的权限。";
    }
    return (
      error.failure.detail?.trim() || error.failure.title?.trim() || "服务商操作失败，请稍后重试。"
    );
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    return /fetch|network|load failed|failed to load/i.test(message)
      ? "无法连接后台 API，请保留当前配置后重试。"
      : message || "服务商操作失败，请稍后重试。";
  }
  return "服务商操作失败，请稍后重试。";
}
