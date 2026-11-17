"use client";

import { Input } from "@roamlog/ui";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { searchCities } from "./geo";
import type { CitySearchResult } from "./map-types";

export interface CitySearchProps {
  onSelect: (result: CitySearchResult) => void;
  fetcher?: typeof fetch;
  geocoderUrl?: string;
  debounceMs?: number;
  label?: string;
}

export function CitySearch({
  onSelect,
  fetcher,
  geocoderUrl,
  debounceMs = 300,
  label = "搜索城市",
}: CitySearchProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      searchCities(trimmed, {
        fetcher,
        geocoderUrl,
        signal: controller.signal,
      })
        .then((nextResults) => {
          setResults(nextResults);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "城市搜索暂时不可用。");
          setResults([]);
          setLoading(false);
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, debounceMs, fetcher, geocoderUrl]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入城市名，例如 京都"
          aria-label={label}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-10 pl-8 text-xs"
        />
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-stone motion-reduce:animate-none"
          />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-[10px] leading-4 text-accent-red">
          城市搜索失败，可直接手动输入坐标。{error}
        </p>
      ) : null}

      {results.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="城市搜索结果"
          className="overflow-hidden rounded-control border border-hairline bg-surface-1"
        >
          {results.map((result) => (
            <li key={result.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onSelect(result);
                  setResults([]);
                  setQuery("");
                }}
                className="flex w-full items-start gap-2 border-b border-hairline px-2.5 py-2 text-left last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <MapPin aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-accent-orange" />
                <span className="min-w-0">
                  <span className="block truncate text-[11px] text-ink">{result.name}</span>
                  <span className="block truncate text-[9px] text-muted">
                    {[result.region, result.country].filter(Boolean).join(" · ")} ·{" "}
                    {result.lat.toFixed(3)}, {result.lng.toFixed(3)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {query.trim().length >= 2 && !loading && !error && results.length === 0 ? (
        <p className="text-[10px] leading-4 text-stone">没有匹配的城市，试试更短的名称。</p>
      ) : null}
    </div>
  );
}
