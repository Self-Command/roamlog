"use client";

import type { Place } from "@roamlog/contracts";
import { Badge, Button, IconButton, Input } from "@roamlog/ui";
import { ChevronDown, ChevronUp, MapPin, X } from "lucide-react";
import * as React from "react";

import {
  SearchableCombobox,
  type ComboboxOption,
  type ComboboxSearch,
} from "@/components/forms/searchable-combobox";
import { usePlacesSearchAttribution } from "@/components/map/places-attribution";

import { FormRow } from "./field-shell";
import { TRIP_FORM_LIMITS, type TripFormDestination } from "./trip-form-state";

export interface DestinationsFieldProps {
  comboboxId: string;
  manualInputId: string;
  destinations: TripFormDestination[];
  /** Resolves a combobox result id back to the Place captured by the search. */
  resolvePlace: (optionId: string) => Place | undefined;
  onAddPlace: (place: Place) => void;
  onAddManual: (name: string) => void;
  onReplacePlace: (index: number, place: Place) => void;
  onReplaceManual: (index: number, name: string) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  search: ComboboxSearch;
  disabled?: boolean;
  error?: string;
}

function isNameOnly(destination: TripFormDestination): boolean {
  return (
    destination.providerPlaceId === null &&
    destination.address === null &&
    destination.countryCode === null &&
    destination.lat === null &&
    destination.lng === null
  );
}

export function DestinationsField({
  comboboxId,
  manualInputId,
  destinations,
  resolvePlace,
  onAddPlace,
  onAddManual,
  onReplacePlace,
  onReplaceManual,
  onRemove,
  onMove,
  search,
  disabled = false,
  error,
}: DestinationsFieldProps) {
  const [query, setQuery] = React.useState("");
  const [manualValue, setManualValue] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [replaceIndex, setReplaceIndex] = React.useState<number | null>(null);
  const placesSearch = usePlacesSearchAttribution(search);

  function handleQueryChange(next: string) {
    // A new query invalidates the results (and the credit) currently on screen.
    placesSearch.reset();
    setQuery(next);
  }

  function clearQuery() {
    placesSearch.reset();
    setQuery("");
    setReplaceIndex(null);
  }

  function startReplace(index: number) {
    const destination = destinations[index];
    if (!destination) return;
    setReplaceIndex(index);
    setLocalError(null);
    placesSearch.reset();
    setQuery(destination.name);
  }

  /**
   * Shared validation for both "add" and "replace". A replacement is allowed to
   * keep the row it replaces; every other row still counts for duplicates.
   */
  function validate(name: string, targetIndex: number | null): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "请输入目的地名称";
    if (trimmed.length > TRIP_FORM_LIMITS.destinationLength) {
      return `单个目的地不能超过 ${TRIP_FORM_LIMITS.destinationLength} 个字符`;
    }
    const duplicate = destinations.some(
      (destination, index) =>
        index !== targetIndex && destination.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) return `「${trimmed}」已在目的地列表中`;
    if (targetIndex === null && destinations.length >= TRIP_FORM_LIMITS.destinationCount) {
      return `最多添加 ${TRIP_FORM_LIMITS.destinationCount} 个目的地`;
    }
    return null;
  }

  function commitPlace(place: Place) {
    if (replaceIndex !== null) {
      const message = validate(place.name, replaceIndex);
      if (message) {
        setLocalError(message);
        return;
      }
      setLocalError(null);
      onReplacePlace(replaceIndex, place);
      clearQuery();
      return;
    }
    const message = validate(place.name, null);
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError(null);
    onAddPlace(place);
    clearQuery();
  }

  function commitManual(rawName: string) {
    const name = rawName.trim();
    if (replaceIndex !== null) {
      const message = validate(name, replaceIndex);
      if (message) {
        setLocalError(message);
        return;
      }
      setLocalError(null);
      onReplaceManual(replaceIndex, name);
      clearQuery();
      setManualValue("");
      return;
    }
    const message = validate(name, null);
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError(null);
    onAddManual(name);
    clearQuery();
    setManualValue("");
  }

  function handlePlaceSelect(option: ComboboxOption) {
    const place = resolvePlace(option.id);
    if (place) {
      commitPlace(place);
      return;
    }
    // A stale option id (search replaced by a newer query): fall back to the
    // label so the typed intent is never silently dropped.
    commitManual(option.label);
  }

  return (
    <FormRow
      id={comboboxId}
      label="途经目的地"
      hint="搜索全球地点可保存地址、坐标与时区；手动填写则只保存名称。最多 30 个，顺序会显示在旅行路线上。"
      error={error ?? localError ?? undefined}
    >
      {({ describedBy, invalid }) => (
        <div>
          {replaceIndex !== null ? (
            <div
              role="status"
              className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-control border border-hairline-strong bg-surface-1 px-3 py-2"
            >
              <span className="type-meta">
                正在替换第 {replaceIndex + 1} 个目的地「{destinations[replaceIndex]?.name}」，
                搜索或手动输入后确认。
              </span>
              <Button type="button" variant="link" size="sm" onClick={clearQuery} className="h-auto px-0">
                取消替换
              </Button>
            </div>
          ) : null}

          <SearchableCombobox
            id={comboboxId}
            label="搜索目的地"
            value={query}
            onValueChange={handleQueryChange}
            onSelect={handlePlaceSelect}
            onManual={commitManual}
            onClear={clearQuery}
            search={placesSearch.search}
            listFooter={placesSearch.footer}
            placeholder="搜索城市或地点，例如「金泽」"
            disabled={disabled}
            invalid={invalid}
            allowManual
            manualLabel={(value) =>
              replaceIndex !== null ? `用「${value}」替换` : `手动添加「${value}」`
            }
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
                  commitManual(manualValue);
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
              onClick={() => commitManual(manualValue)}
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
              还没有目的地。搜索一个地点，或手动添加名称；添加后会按顺序出现在右侧预览中。
            </p>
          ) : (
            <ol className="divide-y divide-hairline" aria-label="已添加的目的地">
              {destinations.map((destination, index) => {
                const nameOnly = isNameOnly(destination);
                const hasCoordinates = destination.lat !== null && destination.lng !== null;
                return (
                  <li
                    key={`${destination.id ?? "new"}-${nameOnly ? destination.name : destination.providerPlaceId ?? destination.name}-${index}`}
                    className="flex items-start gap-2 py-2 sm:gap-3"
                  >
                    <span className="type-meta w-5 shrink-0 pt-0.5 tabular-nums text-stone">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{destination.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={nameOnly ? "slate" : destination.provider !== "local" ? "blue" : "slate"}>
                          {nameOnly ? "仅名称" : destination.provider !== "local" ? "地点库" : "手动地点"}
                        </Badge>
                        {destination.address ? (
                          <span className="type-meta max-w-full">{destination.address}</span>
                        ) : destination.countryCode ? (
                          <span className="type-meta">{destination.countryCode}</span>
                        ) : null}
                        {destination.timeZone ? (
                          <span className="type-meta">{destination.timeZone}</span>
                        ) : null}
                        {hasCoordinates ? (
                          <span className="type-meta tabular-nums">
                            {destination.lat?.toFixed(4)}, {destination.lng?.toFixed(4)}
                          </span>
                        ) : (
                          <span className="type-meta">坐标为空</span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconButton
                        aria-label={`搜索替换「${destination.name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled}
                        onClick={() => startReplace(index)}
                      >
                        <MapPin aria-hidden="true" className="size-4" />
                      </IconButton>
                      <IconButton
                        aria-label={`上移「${destination.name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled || index === 0}
                        onClick={() => onMove(index, -1)}
                      >
                        <ChevronUp aria-hidden="true" className="size-4" />
                      </IconButton>
                      <IconButton
                        aria-label={`下移「${destination.name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled || index === destinations.length - 1}
                        onClick={() => onMove(index, 1)}
                      >
                        <ChevronDown aria-hidden="true" className="size-4" />
                      </IconButton>
                      <IconButton
                        aria-label={`移除「${destination.name}」`}
                        size="sm"
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (replaceIndex === index) clearQuery();
                          onRemove(index);
                        }}
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