"use client";

import * as React from "react";

import type {
  ComboboxSearch,
  ComboboxSearchResult,
} from "@/components/forms/searchable-combobox";
import { placesAttribution, type PlacesProvider } from "@/lib/places-attribution";

export interface PlacesAttributionProps {
  provider: PlacesProvider;
  /**
   * `inline` sits on a true-black canvas (stone ink passes 4.5:1 there).
   * `overlay` sits on map imagery, where a translucent plate and a brighter
   * ink are required to keep the credit readable.
   */
  tone?: "inline" | "overlay";
  className?: string;
}

const FOCUS_RING =
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-black";

/**
 * Renders the credit returned by `placesAttribution`.
 *
 * The full and compact variants are both in the DOM so a screen reader always
 * gets readable text, while the 390px layout only ever shows the short form.
 * The link is a real focusable anchor: attribution must not be `aria-hidden`.
 */
export function PlacesAttribution({
  provider,
  tone = "inline",
  className,
}: PlacesAttributionProps) {
  const attribution = placesAttribution(provider);
  const ink = tone === "overlay" ? "text-white/70" : "text-stone";
  const base = `inline-flex max-w-full items-center whitespace-nowrap text-[10px] leading-4 ${ink} ${
    className ?? ""
  }`;

  if (!attribution.href) {
    return (
      <span
        data-testid="places-attribution"
        data-provider={provider ?? "unknown"}
        className={base}
      >
        <span className="truncate">{attribution.text}</span>
      </span>
    );
  }

  return (
    <span
      data-testid="places-attribution"
      data-provider={provider ?? "unknown"}
      className={base}
    >
      <a
        href={attribution.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`pointer-events-auto max-w-full truncate underline decoration-current/30 underline-offset-2 transition-colors hover:text-ink ${FOCUS_RING}`}
      >
        <span className="sm:hidden">{attribution.short}</span>
        <span className="hidden sm:inline">{attribution.text}</span>
      </a>
    </span>
  );
}

interface TrackedSearchState {
  status: "idle" | "loading" | "ready";
  count: number;
  provider: PlacesProvider;
}

export interface PlacesSearchAttribution {
  /** Search wrapper that records the provider of the latest resolved response. */
  search: ComboboxSearch;
  /** Footer node for `SearchableCombobox`, or `undefined` while there is nothing to credit. */
  footer: React.ReactNode;
  /** The provider behind the visible results (null until a response arrives). */
  provider: PlacesProvider;
  /** Call whenever the query changes so a stale response never revives the credit. */
  reset: () => void;
}

const IDLE: TrackedSearchState = { status: "idle", count: 0, provider: null };

/**
 * Tracks which provider produced the results currently shown by a combobox and
 * builds the matching footer. The provider travels with the search response
 * (`ComboboxSearchResult.provider`) so the credit can never be hard-coded.
 */
export function usePlacesSearchAttribution(search: ComboboxSearch): PlacesSearchAttribution {
  const [state, setState] = React.useState<TrackedSearchState>(IDLE);
  const epochRef = React.useRef(0);

  const trackedSearch = React.useCallback<ComboboxSearch>(
    async (query, context) => {
      const epoch = ++epochRef.current;
      setState((current) => ({ ...current, status: "loading" }));
      try {
        const result: ComboboxSearchResult = await search(query, context);
        if (epoch === epochRef.current) {
          setState({
            status: "ready",
            count: result.items.length,
            provider: result.provider ?? null,
          });
        }
        return result;
      } catch (error) {
        if (epoch === epochRef.current) setState(IDLE);
        throw error;
      }
    },
    [search],
  );

  const reset = React.useCallback(() => {
    epochRef.current += 1;
    setState(IDLE);
  }, []);

  const visible = state.status === "ready" && state.count > 0;

  return {
    search: trackedSearch,
    footer: visible ? <PlacesAttribution provider={state.provider} /> : undefined,
    provider: state.provider,
    reset,
  };
}