import { Inject, Injectable } from "@nestjs/common";
import type { Place } from "@roamlog/contracts";

import { PLACES_SETTINGS, type PlacesSettings, type PlacesSettingsSource } from "./places.settings.js";
import {
  TencentPayloadError,
  normalizeTencentGeocodePayload,
  normalizeTencentReversePayload,
  normalizeTencentSuggestionPayload,
} from "./tencent-normalizer.js";

/**
 * Tencent Map WebService client.
 *
 * Endpoints (paths come straight from the documentation):
 * - 关键词输入提示 `GET /ws/place/v1/suggestion`
 *   https://lbs.qq.com/service/webService/webServiceGuide/webServiceSuggestion
 * - 地址解析（地址转坐标）`GET /ws/geocoder/v1/?address=`
 *   逆地址解析（坐标位置描述）`GET /ws/geocoder/v1/?location=lat,lng`
 *   https://lbs.qq.com/service/webService/webServiceGuide/webServiceGeocoder
 * - JSON `status` codes: https://lbs.qq.com/service/webService/webServiceGuide/status
 *
 * Behaviour:
 * - Only `key`, `keyword`, `page_size`, `address` and `location` are forwarded.
 *   Cookies, authorization headers and any user identity are never sent, and the
 *   key never reaches a log line.
 * - One `AbortController` enforces a single budget (1.5 s by default; the observed
 *   Tencent latency is 0.35–0.45 s). **There is no retry**: `status: 121`
 *   (每日调用量已达到上限) surfaces as `QUOTA_EXCEEDED` and must never be retried.
 * - Every failure becomes a typed outcome so the caller can degrade instead of
 *   failing the HTTP request.
 */
@Injectable()
export class TencentClient {
  constructor(@Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource) {}

  /** `place/v1/suggestion` — the autocomplete used for Chinese address entry. */
  async suggest(input: TencentSuggestInput): Promise<TencentSuggestOutcome> {
    const settings = await this.settings.resolve();
    const startedAt = Date.now();
    const target = endpointOf(settings, "place/v1/suggestion");
    if ("failure" in target) {
      return target.failure;
    }

    target.url.searchParams.set("keyword", input.q);
    target.url.searchParams.set("page_size", String(input.limit));
    target.url.searchParams.set("key", target.apiKey);

    // 347/387/393 are documented "no result" answers: an empty list, not a failure.
    const outcome = await this.send(
      target.url,
      settings.tencentTimeoutMs,
      startedAt,
      normalizeTencentSuggestionPayload,
      [],
    );
    return outcome.ok
      ? { ok: true, items: outcome.value, durationMs: Date.now() - startedAt }
      : outcome;
  }

  /** `geocoder/v1?address=` — forward geocoding of one structured address. */
  async geocode(input: TencentGeocodeInput): Promise<TencentPlaceOutcome> {
    const settings = await this.settings.resolve();
    const startedAt = Date.now();
    const target = endpointOf(settings, "geocoder/v1");
    if ("failure" in target) {
      return target.failure;
    }

    target.url.searchParams.set("address", input.address);
    target.url.searchParams.set("key", target.apiKey);

    const outcome = await this.send(
      target.url,
      settings.tencentTimeoutMs,
      startedAt,
      normalizeTencentGeocodePayload,
    );
    return outcome.ok
      ? { ok: true, place: outcome.value, durationMs: Date.now() - startedAt }
      : outcome;
  }

  /** `geocoder/v1?location=lat,lng` — reverse geocoding; note the lat,lng order. */
  async reverse(input: TencentReverseInput): Promise<TencentPlaceOutcome> {
    const settings = await this.settings.resolve();
    const startedAt = Date.now();
    const target = endpointOf(settings, "geocoder/v1");
    if ("failure" in target) {
      return target.failure;
    }

    target.url.searchParams.set("location", `${input.lat},${input.lng}`);
    target.url.searchParams.set("key", target.apiKey);

    const outcome = await this.send(
      target.url,
      settings.tencentTimeoutMs,
      startedAt,
      (payload) =>
        normalizeTencentReversePayload(payload, { lat: input.lat, lng: input.lng }),
    );
    return outcome.ok
      ? { ok: true, place: outcome.value, durationMs: Date.now() - startedAt }
      : outcome;
  }

  /**
   * One bounded request. `noResultValue` marks the endpoints for which the
   * documented "no result" statuses are an empty answer instead of a failure.
   */
  private async send<T>(
    endpoint: URL,
    timeoutMs: number,
    startedAt: number,
    map: (payload: Record<string, unknown>) => T,
    noResultValue?: T,
  ): Promise<{ readonly ok: true; readonly value: T } | TencentFailure> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "follow",
        credentials: "omit",
        signal: controller.signal,
      });

      const elapsed = Date.now() - startedAt;
      if (!response.ok) {
        return { ...transportFailure("HTTP_ERROR"), httpStatus: response.status, durationMs: elapsed };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ...transportFailure("INVALID_PAYLOAD"), durationMs: elapsed };
      }

      const root =
        typeof payload === "object" && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : undefined;
      if (root === undefined) {
        return { ...transportFailure("INVALID_PAYLOAD"), durationMs: elapsed };
      }

      const status = root.status;
      if (status !== 0) {
        if (
          typeof status === "number" &&
          NO_RESULT_STATUSES.has(status) &&
          noResultValue !== undefined
        ) {
          return { ok: true, value: noResultValue };
        }
        return { ...statusFailure(status, root.message), durationMs: elapsed };
      }

      try {
        return { ok: true, value: map(root) };
      } catch (error) {
        if (error instanceof TencentPayloadError) {
          return { ...transportFailure("INVALID_PAYLOAD"), durationMs: elapsed };
        }
        throw error;
      }
    } catch {
      return {
        ...transportFailure(controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR"),
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface TencentSuggestInput {
  readonly q: string;
  readonly limit: number;
}

export interface TencentGeocodeInput {
  readonly address: string;
}

export interface TencentReverseInput {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Failure codes. They mirror the documentation's `status` grouping and stay
 * uppercase so a caller can branch on `QUOTA_EXCEEDED` without re-parsing.
 */
export type TencentFailureCode =
  | "NOT_CONFIGURED"
  | "INVALID_URL"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_PAYLOAD"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR"
  | "NO_RESULT"
  | "UNKNOWN_STATUS";

/** Lowercase form kept for logs, matching the other places clients' reasons. */
export type TencentFailureReason = Lowercase<TencentFailureCode>;

export interface TencentFailure {
  readonly ok: false;
  readonly code: TencentFailureCode;
  readonly reason: TencentFailureReason;
  readonly durationMs: number;
  /** HTTP response status, when the transport reached the server. */
  readonly httpStatus?: number;
  /** Tencent's JSON `status`; absent for transport failures. */
  readonly upstreamStatus?: number;
  /** Tencent's JSON `message`. Never contains the request key. */
  readonly upstreamMessage?: string;
}

/** `status: 121` — this key's daily call allowance is exhausted. */
export const TENCENT_QUOTA_EXCEEDED_STATUS = 121;
/** `status: 120` — this key's per-second call allowance is exhausted. */
export const TENCENT_RATE_LIMITED_STATUS = 120;

/** Documented "no result" answers; see `send`. */
const NO_RESULT_STATUSES: ReadonlySet<number> = new Set([347, 387, 393]);

/**
 * Documented `status` grouping (https://lbs.qq.com/service/webService/webServiceGuide/status):
 * 110–199 配额鉴权相关, 3xx/4xx 参数错误, 5xx/600 系统错误.
 */
function statusFailure(status: unknown, message: unknown): TencentFailure {
  const upstreamMessage = shortMessage(message);
  const code = statusCode(status);

  return {
    ok: false,
    code,
    reason: reasonOf(code),
    durationMs: 0,
    ...(typeof status === "number" ? { upstreamStatus: status } : {}),
    ...(upstreamMessage === undefined ? {} : { upstreamMessage }),
  };
}

function statusCode(status: unknown): TencentFailureCode {
  if (status === TENCENT_RATE_LIMITED_STATUS) {
    return "RATE_LIMITED";
  }
  if (status === TENCENT_QUOTA_EXCEEDED_STATUS) {
    return "QUOTA_EXCEEDED";
  }
  if (typeof status !== "number") {
    return "UNKNOWN_STATUS";
  }
  if (status >= 110 && status <= 199) {
    return "UNAUTHORIZED";
  }
  if (status >= 300 && status < 500) {
    return "INVALID_REQUEST";
  }
  if (status >= 500) {
    return "UPSTREAM_ERROR";
  }
  return "UNKNOWN_STATUS";
}

function shortMessage(message: unknown): string | undefined {
  if (typeof message !== "string") {
    return undefined;
  }
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : undefined;
}

function reasonOf(code: TencentFailureCode): TencentFailureReason {
  return code.toLowerCase() as TencentFailureReason;
}

function transportFailure(code: TencentFailureCode): TencentFailure {
  return { ok: false, code, reason: reasonOf(code), durationMs: 0 };
}

interface TencentEndpoint {
  readonly url: URL;
  readonly apiKey: string;
}

function endpointOf(settings: PlacesSettings, path: string): TencentEndpoint | { failure: TencentFailure } {
  const apiKey = settings.tencentApiKey;
  if (!apiKey) {
    return { failure: transportFailure("NOT_CONFIGURED") };
  }

  try {
    const base = settings.tencentBaseUrl.replace(/\/+$/, "");
    return { url: new URL(`${base}/${path}`), apiKey };
  } catch {
    return { failure: transportFailure("INVALID_URL") };
  }
}

export type TencentSuggestOutcome =
  | { readonly ok: true; readonly items: Place[]; readonly durationMs: number }
  | TencentFailure;

export type TencentPlaceOutcome =
  | { readonly ok: true; readonly place: Place; readonly durationMs: number }
  | TencentFailure;
