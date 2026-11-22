"use client";

import { useId } from "react";

import type { ProviderConfigField } from "@roamlog/contracts";
import { Checkbox, FormField, Input, Label, Select, Switch } from "@roamlog/ui";

interface ProviderCatalogFieldProps {
  field: ProviderConfigField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function MultiSelectField({ field, value, error, onChange }: ProviderCatalogFieldProps) {
  const id = useId();
  const selected = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

  function toggle(option: string, checked: boolean) {
    onChange(checked ? [...selected, option] : selected.filter((entry) => entry !== option));
  }

  return (
    <fieldset
      id={id}
      className="w-full"
      aria-describedby={error ? `${id}-error` : field.help ? `${id}-hint` : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        {field.label}
        {field.required ? (
          <span aria-hidden="true" className="ml-1 text-accent-red">
            *
          </span>
        ) : null}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-control border border-hairline-strong bg-surface-1 px-3 py-3">
        {(field.options ?? []).map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-xs text-body">
            <Checkbox
              aria-label={option.label}
              checked={selected.includes(option.value)}
              onCheckedChange={(checked) => toggle(option.value, checked === true)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {field.help ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-muted">
          {field.help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function BooleanField({ field, value, error, onChange }: ProviderCatalogFieldProps) {
  const id = useId();
  return (
    <div className="w-full">
      <Label htmlFor={id}>{field.label}</Label>
      <div className="flex min-h-10 items-center gap-3 rounded-control border border-hairline-strong bg-surface-1 px-3">
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          aria-describedby={error ? `${id}-error` : field.help ? `${id}-hint` : undefined}
        />
        <span className="text-xs text-body">{value === true ? "启用" : "关闭"}</span>
      </div>
      {field.help ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-muted">
          {field.help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs leading-5 text-accent-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ProviderCatalogField({ field, value, error, onChange }: ProviderCatalogFieldProps) {
  if (field.type === "boolean") {
    return <BooleanField field={field} value={value} error={error} onChange={onChange} />;
  }

  if (field.type === "multi-select") {
    return <MultiSelectField field={field} value={value} error={error} onChange={onChange} />;
  }

  if (field.type === "select") {
    return (
      <FormField label={field.label} required={field.required} hint={field.help} error={error}>
        <Select value={textValue(value)} onChange={(event) => onChange(event.currentTarget.value)}>
          <option value="">请选择</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  if (field.type === "integer" || field.type === "number") {
    return (
      <FormField label={field.label} required={field.required} hint={field.help} error={error}>
        <Input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === "integer" ? 1 : undefined)}
          value={numberValue(value)}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            onChange(raw === "" ? "" : event.currentTarget.valueAsNumber);
          }}
        />
      </FormField>
    );
  }

  const inputType = field.type === "url" ? "url" : "text";
  return (
    <FormField label={field.label} required={field.required} hint={field.help} error={error}>
      <Input
        type={inputType}
        value={textValue(value)}
        placeholder={field.type === "model" ? "填写模型 ID" : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </FormField>
  );
}
