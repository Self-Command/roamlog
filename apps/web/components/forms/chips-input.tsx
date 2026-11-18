"use client";

import { Button, Input, Label } from "@roamlog/ui";
import { Plus, X } from "lucide-react";
import * as React from "react";

export interface ChipsInputProps {
  id?: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  maxItems: number;
  maxLength: number;
  /** Noun used in messages and the add button, e.g. 标签 / 同行人. */
  itemNoun?: string;
  /** Accessible label for the text input, defaults to `添加${itemNoun}`. */
  inputLabel?: string;
  addButtonLabel?: string;
}

export function ChipsInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  maxItems,
  maxLength,
  itemNoun = "标签",
  inputLabel,
  addButtonLabel,
}: ChipsInputProps) {
  const reactId = React.useId();
  const inputId = id ?? `${reactId}-chips`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [draft, setDraft] = React.useState("");
  const [localError, setLocalError] = React.useState<string>("");
  const displayError = error || localError;

  function commit(rawValue: string) {
    const next = rawValue.trim();
    if (!next) return;
    if (next.length > maxLength) {
      setLocalError(`单个${itemNoun}不能超过 ${maxLength} 个字符`);
      return;
    }
    if (values.some((value) => value.toLowerCase() === next.toLowerCase())) {
      setLocalError(`「${next}」已存在，不能重复添加`);
      return;
    }
    if (values.length >= maxItems) {
      setLocalError(`最多只能添加 ${maxItems} 个${itemNoun}`);
      return;
    }
    setLocalError("");
    setDraft("");
    onChange([...values, next]);
  }

  function removeAt(index: number) {
    setLocalError("");
    onChange(values.filter((_, current) => current !== index));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && values.length > 0) {
      event.preventDefault();
      removeAt(values.length - 1);
    }
  }

  const describedBy = [hint ? hintId : null, displayError ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={inputId}>
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-1 text-accent-red">
              *
            </span>
          ) : null}
        </Label>
        <span className="type-meta tabular-nums">
          {values.length}/{maxItems}
        </span>
      </div>

      <div className="flex items-stretch gap-2">
        <Input
          id={inputId}
          type="text"
          value={draft}
          disabled={disabled}
          maxLength={maxLength + 20}
          placeholder={placeholder ?? `输入${itemNoun}，回车添加`}
          aria-label={inputLabel ?? `添加${itemNoun}`}
          aria-invalid={displayError ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (localError) setLocalError("");
          }}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || values.length >= maxItems}
          onClick={() => commit(draft)}
          aria-label={addButtonLabel ?? `添加${itemNoun}`}
        >
          <Plus aria-hidden="true" />
          添加
        </Button>
      </div>

      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-5 text-muted">
          {hint}
        </p>
      ) : null}
      {displayError ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs leading-5 text-accent-red">
          {displayError}
        </p>
      ) : null}

      {values.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {values.map((value, index) => (
            <li
              key={`${value}-${index}`}
              className="inline-flex items-center gap-1 rounded-pill border border-hairline-strong bg-surface-2 py-1 pl-2.5 pr-1 text-xs text-body"
            >
              <span className="max-w-[16rem] truncate">{value}</span>
              <button
                type="button"
                aria-label={`移除${itemNoun}「${value}」`}
                disabled={disabled}
                onClick={() => removeAt(index)}
                className="flex size-5 items-center justify-center rounded-pill text-stone transition-colors hover:bg-surface-1 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
