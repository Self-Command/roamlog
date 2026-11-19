"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";

import type { AdminSettingItem } from "@roamlog/contracts";
import { Badge, Button, Input, Select, Switch, Textarea } from "@roamlog/ui";

import { formatDateTime } from "../../lib/format";
import {
  SETTINGS_SOURCE_LABELS,
  settingValueSource,
  type JsonDraft,
  type SettingDraftValue,
} from "../../lib/admin-settings";
import { cn } from "../admin-shell/cn";
import { settingFieldConsumption } from "./settings-consumption";

interface SettingFieldProps {
  item: AdminSettingItem;
  draft: SettingDraftValue | undefined;
  secretDraft: string;
  revealedValue: string | null;
  revealSecondsLeft: number | null;
  revealError: string | null;
  error: string | null;
  onChange: (value: SettingDraftValue) => void;
  onSecretChange: (value: string) => void;
  onRequestReveal: () => void;
}

function fieldIds(key: string) {
  return {
    label: `setting-${key}-label`,
    help: `setting-${key}-help`,
    source: `setting-${key}-source`,
  };
}

function shellClasses(hasError: boolean, envLocked: boolean): string {
  return cn(
    "rounded-card border bg-surface-1 p-4 sm:p-5",
    hasError
      ? "border-accent-red/35"
      : envLocked
        ? "border-hairline bg-surface-deep/40"
        : "border-hairline-strong",
  );
}

function FieldHeading({
  item,
  ids,
  error,
}: {
  item: AdminSettingItem;
  ids: ReturnType<typeof fieldIds>;
  error: string | null;
}) {
  const consumption = settingFieldConsumption(item.key);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={ids.label} className="text-[13px] font-medium text-ink">
          {item.label}
        </h3>
        <Badge tone="neutral">{item.type}</Badge>
        {item.isPublic ? <Badge tone="blue">公开</Badge> : null}
        {item.isSecret ? <Badge tone="orange">密钥</Badge> : null}
        {consumption ? (
          <Badge
            tone={consumption.status === "frontend" ? "green" : "yellow"}
            aria-label={`${item.label} 前端消费状态`}
          >
            {consumption.label}
          </Badge>
        ) : null}
      </div>
      <code className="mt-1.5 block font-mono text-[9px] text-muted">{item.key}</code>
      {item.help ? (
        <p id={ids.help} className="mt-2 max-w-2xl text-[11px] leading-5 text-muted">
          {item.help}
        </p>
      ) : null}
      <p id={ids.source} className="mt-2 font-mono text-[9px] text-stone">
        当前值来源：{SETTINGS_SOURCE_LABELS[settingValueSource(item)]} · 最后更新：
        {formatDateTime(item.updatedAt)}
      </p>
      {item.envLocked ? (
        <p
          role="note"
          className="mt-2 rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-2.5 py-2 text-[10px] leading-4 text-accent-yellow"
        >
          由环境变量锁定，界面不可改。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[11px] leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function JsonObjectEditor({
  item,
  draft,
  labelId,
  onChange,
}: {
  item: AdminSettingItem;
  draft: JsonDraft;
  labelId: string;
  onChange: (value: SettingDraftValue) => void;
}) {
  if (draft.mode === "raw") {
    return (
      <Textarea
        aria-labelledby={labelId}
        aria-label={`${item.label} JSON`}
        value={draft.text}
        readOnly={item.envLocked}
        spellCheck={false}
        className="min-h-32 font-mono text-xs"
        onChange={(event) => onChange({ mode: "raw", text: event.currentTarget.value })}
      />
    );
  }

  const objectRows = draft.rows;

  function updateRow(index: number, patch: { key?: string; valueText?: string }) {
    const rows = objectRows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...patch } : row,
    );
    onChange({ mode: "object", rows });
  }

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_36px] gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-stone sm:grid">
        <span>键</span>
        <span>值（JSON）</span>
        <span />
      </div>
      {objectRows.map((row, index) => (
        <div
          key={row.id}
          className="grid grid-cols-[minmax(0,1fr)_36px] gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_36px]"
        >
          <Input
            aria-label={`${item.label} JSON 键 ${index + 1}`}
            value={row.key}
            readOnly={item.envLocked}
            spellCheck={false}
            className="h-9 font-mono text-xs"
            onChange={(event) => updateRow(index, { key: event.currentTarget.value })}
          />
          <Input
            aria-label={`${item.label} JSON 值 ${index + 1}`}
            value={row.valueText}
            readOnly={item.envLocked}
            spellCheck={false}
            className="h-9 font-mono text-xs"
            onChange={(event) => updateRow(index, { valueText: event.currentTarget.value })}
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={`删除 ${item.label} 第 ${index + 1} 行`}
            disabled={item.envLocked}
            className="h-9 px-2"
            onClick={() =>
              onChange({
                mode: "object",
                rows: objectRows.filter((_, rowIndex) => rowIndex !== index),
              })
            }
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={item.envLocked}
        onClick={() =>
          onChange({
            mode: "object",
            rows: [
              ...objectRows,
              {
                id: `json-row-${Date.now()}-${objectRows.length}`,
                key: "",
                valueText: '""',
              },
            ],
          })
        }
      >
        <Plus aria-hidden="true" />
        添加字段
      </Button>
    </div>
  );
}

function SecretControl({
  item,
  secretDraft,
  revealedValue,
  revealSecondsLeft,
  revealError,
  labelId,
  onSecretChange,
  onRequestReveal,
}: Pick<
  SettingFieldProps,
  | "item"
  | "secretDraft"
  | "revealedValue"
  | "revealSecondsLeft"
  | "revealError"
  | "onSecretChange"
  | "onRequestReveal"
> & { labelId: string }) {
  const hasValue = item.secret?.hasValue === true;
  const maskedValue = hasValue ? `••••${item.secret?.last4 ?? ""}` : "未设置";

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
          当前值
        </p>
        <div className="flex items-center gap-2">
          <Input
            aria-label={`${item.label} 当前值`}
            aria-describedby={labelId}
            readOnly
            value={revealedValue ?? maskedValue}
            spellCheck={false}
            className="h-9 font-mono text-xs"
          />
          {hasValue ? (
            <Button
              variant="outline"
              size="sm"
              aria-label={`显示 ${item.label}（记入审计）`}
              disabled={item.envLocked}
              onClick={onRequestReveal}
            >
              <KeyRound aria-hidden="true" />
              显示
            </Button>
          ) : null}
        </div>
        {revealedValue ? (
          <p role="note" className="mt-1.5 text-[10px] leading-4 text-accent-orange">
            本次显示已记入审计，{revealSecondsLeft ?? 0} 秒后自动隐藏。
          </p>
        ) : null}
        {revealError ? (
          <p role="alert" className="mt-1.5 text-[10px] leading-4 text-accent-red">
            {revealError}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor={`setting-${item.key}-secret`}
          className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-muted"
        >
          设置新值
        </label>
        <Input
          id={`setting-${item.key}-secret`}
          aria-label={`设置新值 ${item.label}`}
          type="password"
          autoComplete="new-password"
          value={secretDraft}
          disabled={item.envLocked}
          placeholder={hasValue ? "输入新值以替换现有密文" : "输入新值"}
          className="h-9 font-mono text-xs"
          onChange={(event) => onSecretChange(event.currentTarget.value)}
        />
        <p className="mt-1.5 text-[10px] leading-4 text-stone">
          保存后仅显示末四位；服务端永不回显明文。
        </p>
      </div>
    </div>
  );
}

export function SettingField(props: SettingFieldProps) {
  const {
    item,
    draft,
    secretDraft,
    revealedValue,
    revealSecondsLeft,
    revealError,
    error,
    onChange,
    onSecretChange,
    onRequestReveal,
  } = props;
  const ids = fieldIds(item.key);

  const control = (() => {
    if (item.type === "secret") {
      return (
        <SecretControl
          item={item}
          secretDraft={secretDraft}
          revealedValue={revealedValue}
          revealSecondsLeft={revealSecondsLeft}
          revealError={revealError}
          labelId={ids.label}
          onSecretChange={onSecretChange}
          onRequestReveal={onRequestReveal}
        />
      );
    }

    if (item.type === "boolean") {
      return (
        <div className="flex items-center gap-3">
          <Switch
            aria-label={item.label}
            aria-labelledby={ids.label}
            checked={draft === true}
            disabled={item.envLocked}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            {draft === true ? "开启" : "关闭"}
          </span>
        </div>
      );
    }

    if (item.type === "number") {
      const value = typeof draft === "string" ? draft : "";
      return (
        <Input
          aria-labelledby={ids.label}
          aria-describedby={ids.help}
          aria-invalid={error ? true : undefined}
          type="number"
          inputMode="decimal"
          step={Number.isInteger(item.default) ? "1" : "any"}
          value={value}
          disabled={item.envLocked}
          className="h-9 font-mono text-xs"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    }

    if (item.type === "json") {
      const jsonDraft: JsonDraft =
        draft && typeof draft === "object" && "mode" in draft
          ? (draft as JsonDraft)
          : { mode: "raw", text: "" };
      return (
        <JsonObjectEditor item={item} draft={jsonDraft} labelId={ids.label} onChange={onChange} />
      );
    }

    const value = typeof draft === "string" ? draft : "";

    if (item.options && item.options.length > 0) {
      const options =
        value && !item.options.includes(value) ? [value, ...item.options] : item.options;
      return (
        <Select
          aria-labelledby={ids.label}
          value={value}
          disabled={item.envLocked}
          className="h-9 font-mono text-xs"
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    }

    return (
      <Input
        aria-labelledby={ids.label}
        aria-describedby={ids.help}
        aria-invalid={error ? true : undefined}
        type="text"
        value={value}
        disabled={item.envLocked}
        placeholder={item.default === null ? "留空表示未设置" : undefined}
        className="h-9 text-xs"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  })();

  return (
    <article
      data-setting-key={item.key}
      aria-label={`设置项 ${item.label}`}
      className={shellClasses(Boolean(error), item.envLocked)}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <FieldHeading item={item} ids={ids} error={error} />
        <div className="w-full shrink-0 xl:max-w-[380px]">{control}</div>
      </div>
    </article>
  );
}