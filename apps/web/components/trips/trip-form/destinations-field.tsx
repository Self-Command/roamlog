"use client";

import { Button, IconButton, Input } from "@roamlog/ui";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import * as React from "react";

import {
  SearchableCombobox,
  type ComboboxOption,
  type ComboboxSearch,
} from "@/components/forms/searchable-combobox";
import { usePlacesSearchAttribution } from "@/components/map/places-attribution";

import { FormRow } from "./field-shell";
import { TRIP_FORM_LIMITS } from "./trip-form-state";

export interface DestinationsFieldProps {
  comboboxId: string;
  manualInputId: string;
  destinations: string[];
  countryCodes: Record<string, string>;
  onAdd: (name: string, countryCode: string | null) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  search: ComboboxSearch;
  disabled?: boolean;
  error?: string;
}

export function DestinationsField({
  comboboxId,
  manualInputId,
  destinations,
  countryCodes,
  onAdd,
  onRemove,
  onMove,
  search,
  disabled = false,
  error,
}: DestinationsFieldProps) {
  const [query, setQuery] = React.useState("");
  const [manualValue, setManualValue] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const placesSearch = usePlacesSearchAttribution(search);

  function handleQueryChange(next: string) {
    // A new query invalidates the results (and the credit) currently on screen.
    placesSearch.reset();
    setQuery(next);
  }

  function clearQuery() {
    placesSearch.reset();
    setQuery("");
  }

  function tryAdd(rawName: string, countryCode: string | null): boolean {
    const name = rawName.trim();
    if (!name) {
      setLocalError("请输入目的地名称");
      return false;
    }
    if (name.length > TRIP_FORM_LIMITS.destinationLength) {
      setLocalError(`单个目的地不能超过 ${TRIP_FORM_LIMITS.destinationLength} 个字符`);
      return false;
    }
    if (destinations.some((item) => item.trim().toLowerCase() === name.toLowerCase())) {
      setLocalError(`「${name}」已在目的地列表中`);
      return false;
    }
    if (destinations.length >= TRIP_FORM_LIMITS.destinationCount) {
      setLocalError(`最多添加 ${TRIP_FORM_LIMITS.destinationCount} 个目的地`);
      return false;
    }
    setLocalError(null);
    onAdd(name, countryCode);
    return true;
  }

  function handlePlaceSelect(option: ComboboxOption) {
    if (tryAdd(option.label, option.meta ?? null)) clearQuery();
  }

  function handleManualSubmit() {
    if (tryAdd(manualValue, null)) setManualValue("");
  }

  return (
    <FormRow
      id={comboboxId}
      label="途经目的地"
      hint="搜索地点或手动输入，最多 30 个，顺序会显示在旅行路线上。"
      error={error ?? localError ?? undefined}
    >
      {({ describedBy, invalid }) => (
        <div>
          <SearchableCombobox
            id={comboboxId}
            label="搜索目的地"
            value={query}
            onValueChange={handleQueryChange}
            onSelect={handlePlaceSelect}
            onManual={(value) => {
              if (tryAdd(value, null)) clearQuery();
            }}
            onClear={clearQuery}
            search={placesSearch.search}
            listFooter={placesSearch.footer}
            placeholder="搜索城市或地点，例如「金泽」"
            disabled={disabled}
            invalid={invalid}
            allowManual
            manualLabel={(value) => `手动添加「${value}」`}
            errorLabel="地点搜索暂时不可用，你可以直接输入地点名称。"
            errorMessages={{
              timeout: "地点搜索超时，你可以直接输入地点名称。",
              offline: "网络连接中断，请检查网络后重试，或直接输入地点名称。",
              invalidResponse: "地点搜索返回异常，你可以直接输入地点名称。",
            }}
            aria-describedby={describedBy}
          />

          <div className="mt-2 flex items-stretch gap-2">
            <Input
              id={manualInputId}
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleManualSubmit();
                }
              }}
              placeholder="手动添加目的地"
              aria-label="手动添加目的地"
              disabled={disabled}
              maxLength={TRIP_FORM_LIMITS.destinationLength}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualSubmit}
              disabled={disabled || manualValue.trim().length === 0}
              className="shrink-0"
            >
              添加
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-b border-hairline pb-2">
            <span className="type-eyebrow">路线顺序</span>
            <span className="type-meta tabular-nums">
              {destinations.length}/{TRIP_FORM_LIMITS.destinationCount}
            </span>
          </div>

          {destinations.length === 0 ? (
            <p className="mt-3 text-xs leading-5 text-muted">
              还没有目的地。添加后会按顺序出现在右侧预览中。
            </p>
          ) : (
            <ol className="divide-y divide-hairline" aria-label="已添加的目的地">
              {destinations.map((name, index) => {
                const countryCode = countryCodes[name.toLowerCase()];
                return (
                  <li key={name} className="flex items-center gap-2 py-2 sm:gap-3">
                    <span className="type-meta w-5 shrink-0 tabular-nums text-stone">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{name}</span>
                      {countryCode ? (
                        <span className="type-meta">{countryCode}</span>
                      ) : (
                        <span className="type-meta text-stone">手动地点</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconButton
                        aria-label={`上移「${name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled || index === 0}
                        onClick={() => onMove(index, -1)}
                      >
                        <ChevronUp aria-hidden="true" className="size-4" />
                      </IconButton>
                      <IconButton
                        aria-label={`下移「${name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled || index === destinations.length - 1}
                        onClick={() => onMove(index, 1)}
                      >
                        <ChevronDown aria-hidden="true" className="size-4" />
                      </IconButton>
                      <IconButton
                        aria-label={`移除「${name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled}
                        onClick={() => onRemove(index)}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </IconButton>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </FormRow>
  );
}
