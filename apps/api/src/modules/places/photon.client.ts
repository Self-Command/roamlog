import { Inject, Injectable } from "@nestjs/common";
import type { Place } from "@roamlog/contracts";

import { PLACES_SETTINGS, type PlacesSettingsSource } from "./places.settings.js";
import { PhotonPayloadError, normalizePhotonPayload } from "./photon-normalizer.js";

/**
 * Reasons a search degrades. They are safe to log: no query text is included.
 */
export type PhotonFailureReason =
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_payload"
  | "invalid_url";

export type PhotonSearchOutcome =
  | { readonly ok: true; readonly items: Place[]; readonly durationMs: number }
  | {
      readonly ok: false;
      readonly reason: PhotonFailureReason;
      readonly durationMs: number;
      readonly httpStatus?: number;
    };

export interface PhotonSearchInput {
  readonly q: string;
  readonly limit: number;
  readonly lang?: "zh" | "en";
  /**
   * Optional `minLon,minLat,maxLon,maxLat` window. The public contract has no
   * bbox parameter yet, so the service never sets it; it stays available for a
   * future map viewport.
   */
  readonly bbox?: readonly [number, number, number, number];
}

type AttemptResult =
  | { readonly status: "ok"; readonly items: Place[] }
  | { readonly status: "http_error"; readonly httpStatus: number }
  | { readonly status: "invalid_payload" };

/**
 * Photon only supports `default|de|en|fr`. The public instance rejects
 * `lang=zh` with `400 {"lang":[{"message":"Language is not supported..."}]}`
 * (verified 2026-11-18), and that rejection can take ~2.4 s, so blindly
 * forwarding `zh` would burn the whole timeout budget and degrade every
 * Chinese search. `zh` therefore falls back to the upstream default (local OSM
 * names); `en` is forwarded.
 */
const FORWARDED_UPSTREAM_LANGS = new Set(["en"]);

function forwardedLang(lang: "zh" | "en" | undefined): string | undefined {
  return lang && FORWARDED_UPSTREAM_LANGS.has(lang) ? lang : undefined;
}

/**
 * Thin Photon client.
 *
 * - Only `q`, `limit`, `lang` and an optional `bbox` are forwarded.
 * - Cookies, authorization headers and any user identity are never sent.
 * - One `AbortController` enforces a single 2.5 s budget across retries.
 * - The public Photon instance only supports `default|de|en|fr` and answers
 *   `400` for `lang=zh` (verified against `https://photon.komoot.io/api` on
 *   2026-11-18). When a request that carried `lang` is rejected with `400`, the
 *   client retries once without `lang` inside the same budget, so Chinese users
 *   get local OSM names instead of a degraded empty list. A self-hosted Photon
 *   that supports `zh` keeps the first attempt.
 * - Every other failure mode (4xx/5xx, timeout, network error, malformed JSON)
 *   is returned as a typed outcome so the caller can degrade instead of 500.
 */
@Injectable()
export class PhotonClient {
  constructor(@Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource) {}

  async search(input: PhotonSearchInput): Promise<PhotonSearchOutcome> {
    const settings = await this.settings.resolve();
    let endpoint: URL;
    try {
      endpoint = new URL(settings.baseUrl);
    } catch {
      return { ok: false, reason: "invalid_url", durationMs: 0 };
    }

    endpoint.searchParams.set("q", input.q);
    endpoint.searchParams.set("limit", String(input.limit));
    const lang = forwardedLang(input.lang);
    if (lang) {
      endpoint.searchParams.set("lang", lang);
    }
    if (input.bbox) {
      endpoint.searchParams.set("bbox", input.bbox.map((value) => String(value)).join(","));
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, settings.timeoutMs));

    try {
      let result = await this.attempt(endpoint, controller.signal);

      // The upstream rejected the language we forwarded. Retry without `lang`
      // once inside the same budget, so a stricter/older Photon build still
      // produces results instead of a degraded empty list.
      if (result.status === "http_error" && result.httpStatus === 400 && lang) {
        endpoint.searchParams.delete("lang");
        result = await this.attempt(endpoint, controller.signal);
      }

      if (result.status === "ok") {
        return { ok: true, items: result.items, durationMs: Date.now() - startedAt };
      }
      if (result.status === "http_error") {
        return {
          ok: false,
          reason: "http_error",
          httpStatus: result.httpStatus,
          durationMs: Date.now() - startedAt,
        };
      }
      return { ok: false, reason: "invalid_payload", durationMs: Date.now() - startedAt };
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

  private async attempt(endpoint: URL, signal: AbortSignal): Promise<AttemptResult> {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "follow",
      credentials: "omit",
      signal,
    });

    if (!response.ok) {
      return { status: "http_error", httpStatus: response.status };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "invalid_payload" };
    }

    try {
      return { status: "ok", items: normalizePhotonPayload(payload) };
    } catch (error) {
      if (error instanceof PhotonPayloadError) {
        return { status: "invalid_payload" };
      }
      throw error;
    }
  }
}
