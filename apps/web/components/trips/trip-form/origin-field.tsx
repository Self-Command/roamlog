"use client";

import { Badge, Button } from "@roamlog/ui";
import { X } from "lucide-react";
import * as React from "react";

import {
  SearchableCombobox,
  type ComboboxOption,
  type ComboboxSearch,
} from "@/components/forms/searchable-combobox";

import { FormRow } from "./field-shell";
import type { TripFormOrigin } from "./trip-form-state";

export interface OriginFieldProps {
  id: string;
  origin: TripFormOrigin | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (option: ComboboxOption) => void;
  onManual: (query: string) => void;
  onClear: () => void;
  search: ComboboxSearch;
  disabled?: boolean;
  error?: string;
}

export function OriginField({
  id,
  origin,
  query,
  onQueryChange,
  onSelect,
  onManual,
  onClear,
  search,
  disabled = false,
  error,
}: OriginFieldProps) {
  const hasManualOnlyText = !origin && query.trim().length > 0;

  return (
    <FormRow
      id={id}
      label="旅行起点"
      hint="搜索地点会自动带上坐标与时区；直接填写则按手动地点保存，坐标为 null。"
      error={error}
    >
      {({ describedBy, invalid }) => (
        <div>
          <SearchableCombobox
            id={id}
            label="旅行起点"
            value={query}
            onValueChange={onQueryChange}
            onSelect={onSelect}
            onManual={onManual}
            onClear={onClear}
            search={search}
            placeholder="搜索城市或地点，例如「京都」"
            disabled={disabled}
            invalid={invalid}
            allowManual
            manualLabel={(value) => `使用「${value}」作为起点`}
            errorLabel="地点搜索暂时不可用，你可以直接输入地点名称。"
            errorMessages={{
              timeout: "地点搜索超时，你可以直接输入地点名称。",
              offline: "网络连接中断，请检查网络后重试，或直接输入地点名称。",
              invalidResponse: "地点搜索返回异常，你可以直接输入地点名称。",
            }}
            aria-describedby={describedBy}
          />

          {origin ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone={origin.provider !== "local" ? "blue" : "slate"}>
                {origin.provider !== "local" ? "地点库" : "手动地点"}
              </Badge>
              {origin.address ? (
                <span className="type-meta max-w-full">{origin.address}</span>
              ) : origin.countryCode ? (
                <span className="type-meta">{origin.countryCode}</span>
              ) : null}
              {origin.timeZone ? (
                <span className="type-meta">{origin.timeZone}</span>
              ) : (
                <span className="type-meta">本地时区</span>
              )}
              {origin.lat !== null && origin.lng !== null ? (
                <span className="type-meta tabular-nums">
                  {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}
                </span>
              ) : (
                <span className="type-meta">坐标为空</span>
              )}
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={onClear}
                disabled={disabled}
                className="h-auto px-0"
              >
                <X aria-hidden="true" className="size-3" />
                清除起点
              </Button>
            </div>
          ) : hasManualOnlyText ? (
            <p className="mt-2 type-meta text-stone">
              手动起点 · 本地时区 · 坐标为空，保存后仍可重新搜索替换。
            </p>
          ) : null}
        </div>
      )}
    </FormRow>
  );
}
