import { Inject, Injectable } from "@nestjs/common";
import type { Place } from "@roamlog/contracts";

import { GeoapifyPayloadError, normalizeGeoapifyPayloadCandidates } from "./geoapify-normalizer.js";
import {
  PLACES_SETTINGS,
  type PlacesSettings,
  type PlacesSettingsSource,
} from "./places.settings.js";
import type { GeoapifyCandidate } from "./ranking/pelias-document.js";

/**
 * Reasons a Geoapify search degrades. They are safe to log: no query text and
 * no API key are included.
 */
export type GeoapifyFailureReason =
  "timeout" | "http_error" | "network_error" | "invalid_payload" | "invalid_url" | "not_configured";

export type GeoapifySearchOutcome =
  | { readonly ok: true; readonly items: Place[]; readonly durationMs: number }
  | {
      readonly ok: false;
      readonly reason: GeoapifyFailureReason;
      readonly durationMs: number;
      readonly httpStatus?: number;
    };

export interface GeoapifySearchInput {
  readonly q: string;
  readonly limit: number;
  readonly lang?: "zh" | "en";
  /**
   * Optional Geoapify bias expression, already formatted by the caller, for
   * example `proximity:135.7681,35.0116`. The current contract has no viewport
   * parameter, so the service never sets it; it stays available for a future
   * map-driven search.
   */
  readonly bias?: string;
}

/**
 * Thin Geoapify autocomplete client.
 *
 * - Only `text`, `lang`, `limit`, an optional `bias` and the server-side
 *   `apiKey` are forwarded.
 * - Cookies, authorization headers and any user identity are never sent.
 * - One `AbortController` enforces a single 1.2 s budget; there is no retry
 *   (the whole point of the short budget is to degrade quickly to Photon).
 * - Missing API key, malformed URL, timeout, network error, non-2xx and
 *   malformed JSON all become typed outcomes so the caller can degrade instead
 *   of failing the request.
 */
@Injectable()
export class GeoapifyClient {
  constructor(@Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource) {}

  async search(
    input: GeoapifySearchInput,
    settingsOverride?: PlacesSettings,
  ): Promise<GeoapifySearchOutcome> {
    const outcome = await this.searchCandidates(input, settingsOverride);
    return outcome.ok
      ? {
          ok: true,
          items: outcome.candidates.map((candidate) => candidate.place),
          durationMs: outcome.durationMs,
        }
      : outcome;
  }

  /**
   * Candidate-preserving form of `search`: keeps `result_type`,
   * `rank.confidence` and address parts for the Pelias adapter.
   */
  async searchCandidates(
    input: GeoapifySearchInput,
    settingsOverride?: PlacesSettings,
  ): Promise<GeoapifyCandidatesOutcome> {
    const settings = settingsOverride ?? (await this.settings.resolve());
    const apiKey = settings.geoapifyApiKey;
    if (!apiKey) {
      return { ok: false, reason: "not_configured", durationMs: 0 };
    }

    let endpoint: URL;
    try {
      endpoint = new URL(settings.geoapifyBaseUrl);
    } catch {
      return { ok: false, reason: "invalid_url", durationMs: 0 };
    }

    endpoint.searchParams.set("text", input.q);
    endpoint.searchParams.set("limit", String(input.limit));
    if (input.lang) {
      endpoint.searchParams.set("lang", input.lang);
    }
    if (input.bias) {
      endpoint.searchParams.set("bias", input.bias);
    }
    endpoint.searchParams.set("apiKey", apiKey);

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, settings.geoapifyTimeoutMs));

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "follow",
        credentials: "omit",
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: "http_error",
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
        };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, reason: "invalid_payload", durationMs: Date.now() - startedAt };
      }

      try {
        return {
          ok: true,
          candidates: normalizeGeoapifyPayloadCandidates(payload),
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof GeoapifyPayloadError) {
          return { ok: false, reason: "invalid_payload", durationMs: Date.now() - startedAt };
        }
        throw error;
      }
    } catch {
      return {
        ok: false,
        reason: controller.signal.aborted ? "timeout" : "network_error",
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type GeoapifyCandidatesOutcome =
  | {
      readonly ok: true;
      readonly candidates: GeoapifyCandidate[];
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly reason: GeoapifyFailureReason;
      readonly durationMs: number;
      readonly httpStatus?: number;
    };
