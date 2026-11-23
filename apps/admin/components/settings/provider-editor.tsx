"use client";

import { useId, useMemo, useRef, useState } from "react";

import type {
  ProviderAdapterDescriptor,
  ProviderCatalogGroup,
  ProviderConfigField,
  ProviderConnection,
  ProviderDiscoveredModel,
  ProviderGroup,
  ProviderModelCapabilities,
  ProviderPreset,
  ProviderSecretFieldDescriptor,
} from "@roamlog/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Select,
  Switch,
} from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";
import { AdminSettingsError } from "../../lib/admin-settings-api";
import type {
  ProviderCreateInput,
  ProviderDraftProbeInput,
  ProviderSettingsApi,
  ProviderUpdateInput,
} from "../../lib/provider-settings-api";
import { providerMutationErrorMessage } from "../../lib/provider-settings";
import { ProviderCatalogField } from "./provider-catalog-field";
import { ProviderModelPicker } from "./provider-model-picker";
import { ProviderProbePanel } from "./provider-probe-panel";
import { ProviderSecretField } from "./provider-secret-field";

interface ProviderTypeOption {
  value: string;
  label: string;
  adapter: ProviderAdapterDescriptor;
  preset: ProviderPreset | null;
}

interface ProviderEditorProps {
  open: boolean;
  group: ProviderGroup;
  catalogGroup: ProviderCatalogGroup;
  provider: ProviderConnection | null;
  groupVersion: number;
  api: ProviderSettingsApi;
  onOpenChange: (open: boolean) => void;
  onSaved: (provider: ProviderConnection) => void | Promise<void>;
  canRevealSecret?: boolean;
  singleActive?: boolean;
  activeProvider?: ProviderConnection | null;
  onActiveProviderDisabled?: () => void | Promise<void>;
}

interface EditorDraft {
  type: string;
  label: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secretDrafts: Record<string, string>;
}

function typeValue(adapter: string, preset: string | null): string {
  return `${adapter}::${preset ?? ""}`;
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function providerTypeOptions(
  catalogGroup: ProviderCatalogGroup,
  provider: ProviderConnection | null,
): readonly ProviderTypeOption[] {
  const options: ProviderTypeOption[] = [];
  for (const adapter of catalogGroup.adapters) {
    if (adapter.presets.length === 0) {
      options.push({
        value: typeValue(adapter.adapter, null),
        label: adapter.label,
        adapter,
        preset: null,
      });
      continue;
    }
    for (const preset of adapter.presets) {
      options.push({
        value: typeValue(adapter.adapter, preset.preset),
        label: preset.label,
        adapter,
        preset,
      });
    }
  }

  if (provider) {
    const current = typeValue(provider.adapter, provider.preset);
    if (!options.some((option) => option.value === current)) {
      const adapter = catalogGroup.adapters.find((entry) => entry.adapter === provider.adapter) ?? {
        adapter: provider.adapter,
        label: provider.adapter,
        capabilities: [],
        configFields: [],
        secretFields: [],
        presets: [],
      };
      const preset =
        adapter.presets.find((entry) => entry.preset === provider.preset) ??
        (provider.preset
          ? { preset: provider.preset, label: provider.preset, defaultBaseUrl: null }
          : null);
      options.unshift({
        value: current,
        label: preset?.label ?? adapter.label,
        adapter,
        preset,
      });
    }
  }

  return options;
}

function configForOption(
  option: ProviderTypeOption | undefined,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  if (!option) {
    return {};
  }
  const config: Record<string, unknown> = {};
  for (const field of option.adapter.configFields) {
    if (existing && Object.prototype.hasOwnProperty.call(existing, field.key)) {
      config[field.key] = cloneJson(existing[field.key]);
    } else if (field.default !== undefined) {
      config[field.key] = cloneJson(field.default);
    } else if (field.key === "baseUrl" && option.preset?.defaultBaseUrl) {
      config[field.key] = option.preset.defaultBaseUrl;
    } else if (field.type === "multi-select") {
      config[field.key] = [];
    } else if (field.type === "boolean") {
      config[field.key] = false;
    }
  }
  return config;
}

/** Keep only fields owned by the selected adapter when building a request. */
function configForAdapter(
  adapter: ProviderAdapterDescriptor,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of adapter.configFields) {
    if (Object.prototype.hasOwnProperty.call(config, field.key)) {
      result[field.key] = cloneJson(config[field.key]);
    }
  }
  return result;
}

function secretsForAdapter(
  adapter: ProviderAdapterDescriptor,
  drafts: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of adapter.secretFields) {
    const value = drafts[field.key]?.trim();
    if (value) {
      result[field.key] = value;
    }
  }
  return result;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function initialDraft(
  group: ProviderCatalogGroup,
  provider: ProviderConnection | null,
  activeProvider: ProviderConnection | null = null,
): EditorDraft {
  const options = providerTypeOptions(group, provider);
  const selected =
    options.find(
      (option) => option.value === typeValue(provider?.adapter ?? "", provider?.preset ?? null),
    ) ?? options[0];
  return {
    type: selected?.value ?? "",
    label: provider?.label ?? "",
    enabled: provider?.enabled ?? !(activeProvider && activeProvider.id !== provider?.id),
    config: configForOption(selected, provider?.config),
    secretDrafts: {},
  };
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function validateConfigField(field: ProviderConfigField, value: unknown): string | null {
  if (field.required && isEmpty(value)) {
    return `${field.label}不能为空。`;
  }
  if (isEmpty(value)) {
    return null;
  }
  if (field.type === "integer" || field.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${field.label}必须是数字。`;
    }
    if (field.type === "integer" && !Number.isInteger(value)) {
      return `${field.label}必须是整数。`;
    }
    if (field.min !== undefined && value < field.min) {
      return `${field.label}不能小于 ${field.min}。`;
    }
    if (field.max !== undefined && value > field.max) {
      return `${field.label}不能大于 ${field.max}。`;
    }
  }
  if (field.type === "url" && typeof value === "string") {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        return `${field.label}必须是有效的 http(s) 地址，且不能包含凭据。`;
      }
    } catch {
      return `${field.label}必须是有效的 URL。`;
    }
  }
  if (
    field.type === "select" &&
    field.options &&
    typeof value === "string" &&
    !field.options.some((option) => option.value === value)
  ) {
    return `${field.label}的取值无效。`;
  }
  return null;
}

function serverErrors(error: unknown): {
  form: string;
  fields: Record<string, string>;
} {
  if (!(error instanceof AdminSettingsError)) {
    return {
      form: providerMutationErrorMessage(error),
      fields: {},
    };
  }

  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(error.errorsByField)) {
    if (key.startsWith("secrets.") || key.startsWith("secret.")) {
      fields[`secret:${key.split(".").at(-1) ?? key}`] = message;
    } else if (key.startsWith("config.")) {
      fields[key.slice("config.".length)] = message;
    } else {
      fields[key] = message;
    }
  }
  return {
    form: providerMutationErrorMessage(error),
    fields,
  };
}

const AI_CAPABILITY_FIELDS: readonly {
  key: keyof ProviderModelCapabilities;
  label: string;
  help: string;
}[] = [
  { key: "vision", label: "图片输入", help: "允许把图片附件发送给这个模型。" },
  { key: "reasoning", label: "推理", help: "该模型支持推理强度或推理输出。" },
  { key: "tools", label: "工具调用", help: "允许模型调用平台提供的工具。" },
];

export function ProviderEditor({
  open,
  group,
  catalogGroup,
  provider,
  groupVersion,
  api,
  onOpenChange,
  onSaved,
  canRevealSecret = false,
  singleActive = false,
  activeProvider = null,
  onActiveProviderDisabled,
}: ProviderEditorProps) {
  const initial = useMemo(
    () => initialDraft(catalogGroup, provider, singleActive ? activeProvider : null),
    [activeProvider, catalogGroup, provider, singleActive],
  );
  const typeOptions = useMemo(
    () => providerTypeOptions(catalogGroup, provider),
    [catalogGroup, provider],
  );
  const [type, setType] = useState(initial.type);
  const [label, setLabel] = useState(initial.label);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>(initial.config);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [providerVersion, setProviderVersion] = useState(provider?.version ?? 0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<readonly ProviderDiscoveredModel[]>([]);
  const [capabilitySaving, setCapabilitySaving] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [activeConflictOpen, setActiveConflictOpen] = useState(false);
  const [disablingActive, setDisablingActive] = useState(false);
  const [disabledActiveId, setDisabledActiveId] = useState<string | null>(null);
  const baseline = useRef(
    stableValue({
      type: initial.type,
      label: initial.label,
      enabled: initial.enabled,
      config: initial.config,
      secretDrafts: {},
    }),
  );
  const labelId = useId();
  const typeId = useId();
  const enabledId = useId();

  const selectedOption = useMemo(
    () => typeOptions.find((option) => option.value === type),
    [type, typeOptions],
  );
  const savedSecrets = useMemo(
    () => new Map((provider?.secrets ?? []).map((secret) => [secret.field, secret])),
    [provider?.secrets],
  );
  const adapter = selectedOption?.adapter;
  const currentModelId = typeof config.defaultModel === "string" ? config.defaultModel : "";
  const currentDiscoveredModel =
    modelCatalog.find((model) => model.modelId === currentModelId) ?? null;
  const currentCapabilities = currentDiscoveredModel?.capabilities ?? {};
  const blockingActiveProvider =
    singleActive &&
    activeProvider &&
    activeProvider.id !== provider?.id &&
    activeProvider.id !== disabledActiveId
      ? activeProvider
      : null;
  const nonEmptySecrets = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(secretDrafts)
          .map(([field, value]) => [field, value.trim()] as const)
          .filter(([, value]) => value.length > 0),
      ),
    [secretDrafts],
  );
  const selectedSecrets = useMemo(
    () => (adapter ? secretsForAdapter(adapter, secretDrafts) : {}),
    [adapter, secretDrafts],
  );
  const dirty =
    stableValue({ type, label, enabled, config, secretDrafts: nonEmptySecrets }) !==
    baseline.current;

  function clearFieldError(key: string) {
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function changeType(nextValue: string) {
    const next = typeOptions.find((option) => option.value === nextValue);
    setType(nextValue);
    // Keep hidden adapter values in the local draft. Requests only include the
    // selected adapter's fields, so switching back restores what the operator
    // typed without leaking unused fields into the saved provider config.
    setConfig((current) => ({ ...current, ...configForOption(next, current) }));
    setFieldErrors({});
    setFormError(null);
  }

  function changeConfig(field: ProviderConfigField, value: unknown) {
    setConfig((current) => ({ ...current, [field.key]: value }));
    clearFieldError(field.key);
    setFormError(null);
  }

  function changeSecret(field: ProviderSecretFieldDescriptor, value: string) {
    setSecretDrafts((current) => ({ ...current, [field.key]: value }));
    clearFieldError(`secret:${field.key}`);
    setFormError(null);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!label.trim()) {
      next.label = "请输入服务商名称。";
    } else if (label.trim().length > 80) {
      next.label = "服务商名称不能超过 80 个字符。";
    }
    if (!adapter) {
      next.form = "该服务商类型不受当前后台版本支持。";
      return next;
    }
    for (const field of adapter.configFields) {
      const error = validateConfigField(field, config[field.key]);
      if (error) {
        next[field.key] = error;
      }
    }
    for (const field of adapter.secretFields) {
      const saved = savedSecrets.get(field.key)?.hasValue === true;
      if (field.required && !saved && !selectedSecrets[field.key]) {
        next[`secret:${field.key}`] = `${field.label}不能为空。`;
      }
    }
    return next;
  }

  function requestClose() {
    if (saving || probing) {
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  function discardAndClose() {
    setConfirmDiscard(false);
    onOpenChange(false);
  }

  function draftProbeInput(): ProviderDraftProbeInput | null {
    if (!adapter) {
      return null;
    }
    return {
      group,
      adapter: adapter.adapter,
      preset: selectedOption?.preset?.preset ?? null,
      config: configForAdapter(adapter, config),
      ...(Object.keys(selectedSecrets).length > 0 ? { secrets: selectedSecrets } : {}),
    };
  }

  async function syncAiModelCatalog(providerId: string, expectedVersion: number): Promise<void> {
    if (group !== "ai" || !adapter?.capabilities.includes("model_discovery")) {
      return;
    }
    const hasUsableKey =
      Boolean(selectedSecrets.apiKey?.trim()) || savedSecrets.get("apiKey")?.hasValue === true;
    if (!hasUsableKey) {
      return;
    }
    try {
      await api.refreshModels(providerId, expectedVersion);
    } catch {
      // The provider is already saved. Reopening the editor exposes the
      // manual "获取模型" retry if this best-effort catalog sync failed.
    }
  }

  async function save() {
    if (saving || probing) {
      return;
    }
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      const { form, ...fields } = errors;
      setFieldErrors(fields);
      setFormError(form ?? "请先修正表单中的问题。");
      return;
    }
    if (!selectedOption || !adapter) {
      setFormError("该服务商类型不受当前后台版本支持。");
      return;
    }
    if (enabled && blockingActiveProvider) {
      setActiveConflictOpen(true);
      setFormError(
        `邮件和存储服务只允许一个启用的服务商。请先停用「${blockingActiveProvider.label}」，再启用当前服务商。`,
      );
      return;
    }

    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      if (!provider) {
        const input: ProviderCreateInput = {
          group,
          adapter: adapter.adapter,
          preset: selectedOption.preset?.preset ?? null,
          label: label.trim(),
          enabled,
          config: configForAdapter(adapter, config),
          ...(Object.keys(selectedSecrets).length > 0 ? { secrets: selectedSecrets } : {}),
          ...(Number.isInteger(groupVersion) && groupVersion > 0
            ? { expectedGroupVersion: groupVersion }
            : {}),
        };
        const created = await api.create(input);
        await syncAiModelCatalog(created.id, created.version);
        await onSaved(created);
        onOpenChange(false);
        return;
      }

      const update: ProviderUpdateInput = {
        adapter: adapter.adapter,
        preset: selectedOption.preset?.preset ?? null,
        label: label.trim(),
        enabled,
        config: configForAdapter(adapter, config),
        expectedVersion: providerVersion,
      };
      const updated = await api.update(provider.id, update);
      let expectedVersion = updated.version;
      for (const [field, value] of Object.entries(selectedSecrets)) {
        await api.replaceSecret(provider.id, field, {
          value,
          expectedVersion,
        });
        expectedVersion += 1;
      }
      await syncAiModelCatalog(provider.id, expectedVersion);
      await onSaved(updated);
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof AdminMutationError &&
        error.failure.code === "PROVIDER_ACTIVE_CONFLICT"
      ) {
        setActiveConflictOpen(true);
        setFormError(providerMutationErrorMessage(error));
        return;
      }
      const next = serverErrors(error);
      setFieldErrors(next.fields);
      setFormError(next.form);
    } finally {
      setSaving(false);
    }
  }

  async function toggleCapability(
    key: keyof ProviderModelCapabilities,
    checked: boolean,
  ): Promise<void> {
    if (!provider || !currentDiscoveredModel || capabilitySaving) {
      return;
    }
    setCapabilitySaving(true);
    setCapabilityError(null);
    try {
      const updated = await api.updateModel(provider.id, currentDiscoveredModel.modelId, {
        capabilities: { ...currentCapabilities, [key]: checked },
        expectedVersion: providerVersion,
      });
      setProviderVersion((current) => current + 1);
      setModelCatalog((current) =>
        current.map((model) =>
          model.modelId === updated.modelId
            ? { ...model, capabilities: updated.capabilities }
            : model,
        ),
      );
    } catch (error) {
      setCapabilityError(providerMutationErrorMessage(error));
    } finally {
      setCapabilitySaving(false);
    }
  }

  async function disableActiveProvider() {
    if (!blockingActiveProvider || disablingActive) {
      return;
    }
    setDisablingActive(true);
    try {
      await api.update(blockingActiveProvider.id, {
        enabled: false,
        expectedVersion: blockingActiveProvider.version,
      });
      setDisabledActiveId(blockingActiveProvider.id);
      setActiveConflictOpen(false);
      setFormError(`已停用「${blockingActiveProvider.label}」。请再次保存当前服务商。`);
      await onActiveProviderDisabled?.();
    } catch (error) {
      setFormError(providerMutationErrorMessage(error));
    } finally {
      setDisablingActive(false);
    }
  }

  const busy = saving || probing;
  const draftProbe = draftProbeInput();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
        } else {
          requestClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{provider ? "编辑服务商" : "添加服务商"}</DialogTitle>
          <DialogDescription>
            填写连接、凭据和运行参数。密钥保存后只显示末四位，不会再次返回明文。
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {formError ? (
            <div
              role="alert"
              className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[12px] leading-5 text-accent-red"
            >
              {formError}
            </div>
          ) : null}

          <section className="space-y-4">
            <h3 className="type-eyebrow">身份</h3>
            <FormField label="名称" required error={fieldErrors.label}>
              <Input
                id={labelId}
                value={label}
                maxLength={80}
                autoFocus
                placeholder="例如：DeepSeek 主账号"
                onChange={(event) => {
                  setLabel(event.currentTarget.value);
                  clearFieldError("label");
                  setFormError(null);
                }}
              />
            </FormField>
            <FormField label="类型" required hint="类型决定需要填写的连接参数和密钥字段。">
              <Select
                id={typeId}
                value={type}
                disabled={typeOptions.length < 2}
                onChange={(event) => changeType(event.currentTarget.value)}
              >
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="flex items-center justify-between gap-4 rounded-control border border-hairline-strong bg-surface-1 px-3 py-2.5">
              <div>
                <Label htmlFor={enabledId} className="mb-0">
                  启用服务商
                </Label>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  停用后不会参与路由，但会保留配置和密钥。
                </p>
              </div>
              <Switch
                id={enabledId}
                checked={enabled}
                onCheckedChange={(next) => {
                  setEnabled(next);
                  setFormError(null);
                }}
              />
            </div>
            {singleActive ? (
              <div
                role="note"
                className="rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2.5 text-[11px] leading-5 text-body"
              >
                {blockingActiveProvider
                  ? `当前已有启用的「${blockingActiveProvider.label}」。新增或切换实例时不会自动停用它；请先明确停用当前实例。`
                  : "邮件和存储服务只允许一个启用的服务商。已启用实例不会被系统自动切换。"}
              </div>
            ) : null}
          </section>

          {adapter ? (
            <section className="space-y-4 border-t border-hairline pt-5">
              <h3 className="type-eyebrow">连接</h3>
              {adapter.configFields.map((field) => {
                const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : "";
                const savedApiKey = savedSecrets.get("apiKey")?.hasValue === true;
                const modelValue = config[field.key];
                if (
                  field.key === "defaultModel" &&
                  adapter.capabilities.includes("model_discovery")
                ) {
                  return (
                    <ProviderModelPicker
                      key={field.key}
                      api={api}
                      group={group}
                      adapter={adapter.adapter}
                      preset={selectedOption?.preset?.preset ?? null}
                      baseUrl={baseUrl}
                      apiKeyDraft={secretDrafts.apiKey ?? ""}
                      hasSavedKey={savedApiKey}
                      providerId={provider?.id}
                      expectedVersion={provider ? providerVersion : undefined}
                      value={typeof modelValue === "string" ? modelValue : ""}
                      label={field.label}
                      help={field.help}
                      error={fieldErrors[field.key]}
                      disabled={saving || probing}
                      onChange={(modelId) => changeConfig(field, modelId)}
                      onVersionBump={setProviderVersion}
                      onModelsChange={setModelCatalog}
                    />
                  );
                }
                return (
                  <ProviderCatalogField
                    key={field.key}
                    field={field}
                    value={config[field.key]}
                    error={fieldErrors[field.key]}
                    onChange={(value) => changeConfig(field, value)}
                  />
                );
              })}
            </section>
          ) : null}

          {adapter && adapter.secretFields.length > 0 ? (
            <section className="space-y-4 border-t border-hairline pt-5">
              <div>
                <h3 className="type-eyebrow">凭据</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  留空表示保留已保存的密钥；输入新值会替换当前密钥。
                </p>
              </div>
              {adapter.secretFields.map((field) => {
                const saved = savedSecrets.get(field.key);
                return (
                  <ProviderSecretField
                    key={field.key}
                    field={field}
                    saved={saved}
                    value={secretDrafts[field.key] ?? ""}
                    error={fieldErrors[`secret:${field.key}`]}
                    canReveal={canRevealSecret}
                    onChange={(value) => changeSecret(field, value)}
                    onReveal={() => api.revealSecret(provider!.id, field.key, true)}
                  />
                );
              })}
            </section>
          ) : null}

          {group === "ai" && provider ? (
            <section className="space-y-3 border-t border-hairline pt-5">
              <div>
                <h3 className="type-eyebrow">模型能力</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  能力由超级管理员显式确认；模型目录里的 capability 声明不会自动开启图片或工具调用。
                </p>
              </div>
              {currentDiscoveredModel ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {AI_CAPABILITY_FIELDS.map((capability) => (
                    <div
                      key={capability.key}
                      className="flex items-start justify-between gap-3 rounded-control border border-hairline bg-surface-1 px-3 py-2.5"
                    >
                      <div>
                        <Label className="mb-0">{capability.label}</Label>
                        <p className="mt-1 text-[10px] leading-4 text-muted">{capability.help}</p>
                      </div>
                      <Switch
                        aria-label={capability.label}
                        checked={currentCapabilities[capability.key] === true}
                        disabled={capabilitySaving || saving || probing}
                        onCheckedChange={(checked) =>
                          void toggleCapability(capability.key, checked)
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-control border border-hairline bg-surface-1 px-3 py-2 text-[11px] leading-5 text-muted">
                  获取模型列表并选择默认模型后，可在这里确认模型能力。
                </p>
              )}
              {capabilityError ? (
                <p role="alert" className="text-[11px] leading-5 text-accent-red">
                  {capabilityError}
                </p>
              ) : null}
            </section>
          ) : null}

          {adapter ? (
            <details className="rounded-control border border-hairline bg-surface-1 px-3 py-2.5">
              <summary className="cursor-pointer text-[12px] font-medium text-body">
                高级诊断
              </summary>
              <dl className="mt-3 grid gap-2 border-t border-hairline pt-3 font-mono text-[10px] text-muted sm:grid-cols-2">
                <div>
                  <dt>Adapter</dt>
                  <dd className="mt-0.5 text-body">{adapter.adapter}</dd>
                </div>
                <div>
                  <dt>Preset</dt>
                  <dd className="mt-0.5 text-body">
                    {selectedOption?.preset?.preset ?? "custom / none"}
                  </dd>
                </div>
                <div>
                  <dt>Provider ID</dt>
                  <dd className="mt-0.5 break-all text-body">{provider?.id ?? "未保存"}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd className="mt-0.5 text-body">v{providerVersion}</dd>
                </div>
              </dl>
            </details>
          ) : null}

          {adapter && draftProbe ? (
            <ProviderProbePanel
              api={api}
              source={{
                kind: "draft",
                input: draftProbe,
                label: label.trim() || "未保存配置",
              }}
              disabled={saving}
              buttonLabel="测试未保存配置"
              onBusyChange={setProbing}
            />
          ) : null}

          {confirmDiscard ? (
            <div
              role="alert"
              className="rounded-control border border-accent-yellow/30 bg-accent-yellow/5 px-3 py-3"
            >
              <p className="text-[12px] font-medium text-ink">放弃未保存的修改？</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">关闭后本次填写内容不会保存。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                  继续编辑
                </Button>
                <Button size="sm" variant="danger" onClick={discardAndClose}>
                  放弃修改
                </Button>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={requestClose}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !adapter}>
              {saving ? "保存中…" : "保存服务商"}
            </Button>
          </DialogFooter>
        </form>

        <Dialog
          open={activeConflictOpen}
          onOpenChange={(open) => {
            if (!open) {
              setActiveConflictOpen(false);
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>服务商启用冲突</DialogTitle>
              <DialogDescription>
                {blockingActiveProvider
                  ? `当前「${blockingActiveProvider.label}」正在启用。邮件和存储服务只允许一个启用的实例。`
                  : "邮件和存储服务只允许一个启用的实例。"}
              </DialogDescription>
            </DialogHeader>
            <p className="text-[11px] leading-5 text-muted">
              本次没有自动停用现有服务商。确认停用后，当前草稿仍会保留，再点击一次保存即可启用。
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={disablingActive}
                onClick={() => setActiveConflictOpen(false)}
              >
                保留草稿
              </Button>
              {blockingActiveProvider ? (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={disablingActive}
                  onClick={() => void disableActiveProvider()}
                >
                  {disablingActive ? "停用中…" : "停用当前实例"}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
