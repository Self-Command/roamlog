"use client";

import { Input } from "@roamlog/ui";
import * as React from "react";

import {
  SearchableCombobox,
  type ComboboxSearch,
} from "@/components/forms/searchable-combobox";
import { formatBudget } from "@/lib/trip-presentation";

import { FormRow } from "./field-shell";
import { searchCurrencies } from "./currencies";
import { parseBudgetAmount } from "./trip-form-state";

export interface BudgetFieldProps {
  amountId: string;
  currencyId: string;
  amount: string;
  currency: string;
  onAmountChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  amountError?: string;
  currencyError?: string;
  disabled?: boolean;
}

export function BudgetField({
  amountId,
  currencyId,
  amount,
  currency,
  onAmountChange,
  onCurrencyChange,
  amountError,
  currencyError,
  disabled = false,
}: BudgetFieldProps) {
  const search = React.useCallback<ComboboxSearch>(
    async (query) => ({
      items: searchCurrencies(query).map((option) => ({
        id: option.code,
        label: option.code,
        description: option.name,
      })),
    }),
    [],
  );

  const parsed = React.useMemo(() => parseBudgetAmount(amount), [amount]);
  const normalizedCurrency = currency.trim().toUpperCase();
  const preview =
    parsed.ok && parsed.amountMinor !== null && /^[A-Z]{3}$/.test(normalizedCurrency)
      ? formatBudget(parsed.amountMinor, normalizedCurrency)
      : null;

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
      <FormRow
        id={amountId}
        label="预算金额"
        hint="以元为单位输入，最多两位小数；保存时转换成分。"
        error={amountError}
      >
        {({ describedBy, invalid }) => (
          <Input
            id={amountId}
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          />
        )}
      </FormRow>

      <FormRow id={currencyId} label="币种" hint="三位 ISO 4217 代码。" error={currencyError}>
        {({ describedBy, invalid }) => (
          <SearchableCombobox
            id={currencyId}
            label="搜索币种"
            value={currency}
            onValueChange={(value) => onCurrencyChange(value.toUpperCase())}
            onSelect={(option) => onCurrencyChange(option.id.toUpperCase())}
            onManual={(value) => onCurrencyChange(value.trim().toUpperCase())}
            onClear={() => onCurrencyChange("")}
            search={search}
            placeholder="CNY"
            disabled={disabled}
            invalid={invalid}
            allowManual
            manualLabel={(value) => `使用「${value.toUpperCase()}」`}
            loadingLabel="正在匹配币种…"
            emptyLabel="没有匹配的币种，可直接输入三位代码"
            errorLabel="币种匹配失败，可直接输入三位代码。"
            aria-describedby={describedBy}
          />
        )}
      </FormRow>

      <p className="type-meta sm:col-span-2" role="status">
        {preview
          ? `预览 ${preview} · 保存为 ${parsed.ok ? parsed.amountMinor : 0} ${normalizedCurrency}（最小货币单位）`
          : "金额与币种需成对填写，两者都为空表示不设置预算。"}
      </p>
    </div>
  );
}
