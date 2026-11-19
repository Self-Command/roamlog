import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { StorageSettingsConsumer } from "../settings/storage-settings.consumer.js";
import {
  buildStorageClients,
  normalizedEndpoint,
  resolveSigningEndpoint,
  type BuiltStorageClients,
  type StorageClientBuilder,
} from "./storage-clients.js";
import { STORAGE_CLIENT_BUILDER, StorageConfigurationError } from "./storage-client.factory.js";

export interface StorageProbeCheck {
  name: "HeadBucket" | "PutObject" | "GetObject" | "PresignedGet" | "DeleteObject";
  ok: boolean;
  ms: number;
}

export type StorageProbeStage = "Config" | StorageProbeCheck["name"];

export interface StorageProbeBase {
  bucket: string;
  endpoint: string;
  publicEndpoint: string;
}

export interface StorageProbeSuccess extends StorageProbeBase {
  ok: true;
  checks: StorageProbeCheck[];
}

export interface StorageProbeFailure extends StorageProbeBase {
  ok: false;
  checks: StorageProbeCheck[];
  failedAt: StorageProbeStage;
  code: string;
  message: string;
  /** Only set when the server could not fetch the presigned URL at all. */
  publicEndpointUnreachable?: boolean;
}

export type StorageProbeResult = StorageProbeSuccess | StorageProbeFailure;

/** Body written by the probe; verified byte-for-byte on read. */
export const STORAGE_PROBE_BODY = "roamlog storage probe";
export const STORAGE_PROBE_TIMEOUT_MS = 8_000;
export const STORAGE_PROBE_FETCH_TIMEOUT_MS = 5_000;

interface ProbeFailure {
  stage: StorageProbeStage;
  code: string;
  message: string;
  publicEndpointUnreachable?: boolean;
}

interface Measured<T> {
  ok: true;
  value: T;
  ms: number;
}

interface MeasuredFailure {
  ok: false;
  error: unknown;
  ms: number;
}

type MeasureResult<T> = Measured<T> | MeasuredFailure;

/**
 * "Test connection" for the effective storage configuration.
 *
 * Runs the six-step sequence from the design document (HeadBucket -> PutObject
 * -> GetObject + byte comparison -> presigned GET fetched by the server ->
 * DeleteObject) and stops at the first failing step.
 *
 * The presigned fetch failure is treated as a failed probe (`ok: false`) with
 * `publicEndpointUnreachable: true`: the configured browser origin could not be
 * reached from the API, so "signed URLs are usable" is not proven. It is
 * intentionally conservative — a deployment where only browsers (and not the
 * API) can resolve the public host still works, but the operator then sees the
 * exact failing step instead of a green check that was never exercised.
 *
 * Nothing secret is returned or logged: responses carry only step names,
 * timings, codes and static messages, and errors are classified from their
 * name/HTTP status rather than echoed. The presigned URL (which embeds the
 * access-key id and a signature) is never logged.
 */
@Injectable()
export class StorageProbeService {
  private readonly builder: StorageClientBuilder;

  constructor(
    @Inject(StorageSettingsConsumer) private readonly consumer: StorageSettingsConsumer,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Optional() @Inject(STORAGE_CLIENT_BUILDER) builder?: StorageClientBuilder,
  ) {
    this.builder = builder ?? buildStorageClients;
  }

  async run(): Promise<StorageProbeResult> {
    // A probe is an explicit operator action: bypass the 5s cache so the
    // result reflects what was just saved.
    this.consumer.invalidate();
    const resolved = await this.consumer.resolve();
    const base: StorageProbeBase = {
      bucket: resolved.settings.bucket,
      endpoint: normalizedEndpoint(resolved.settings.endpoint),
      publicEndpoint: resolveSigningEndpoint(resolved.settings),
    };

    let clients: BuiltStorageClients;
    try {
      clients = this.builder(resolved.settings, base.publicEndpoint);
    } catch (error) {
      const { stage, ...detail } = classifyConfigFailure(error);
      this.logger.warn(
        { code: detail.code, stage },
        "storage.probe_config_invalid",
      );
      return { ...base, ok: false, checks: [], failedAt: stage, ...detail };
    }

    const { internal, public: signing } = clients;
    const bucket = resolved.settings.bucket;
    const key = `_probe/${randomUUID()}.txt`;
    const checks: StorageProbeCheck[] = [];
    let needsCleanup = false;

    try {
      const head = await this.measure(() =>
        withTimeout(
          internal.send(new HeadBucketCommand({ Bucket: bucket })),
          STORAGE_PROBE_TIMEOUT_MS,
          "The storage probe timed out.",
        ),
      );
      checks.push(toCheck("HeadBucket", head));
      if (!head.ok) {
        return this.fail(base, checks, "HeadBucket", head.error);
      }

      const put = await this.measure(() =>
        withTimeout(
          internal.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: STORAGE_PROBE_BODY,
              ContentType: "text/plain",
              ContentLength: Buffer.byteLength(STORAGE_PROBE_BODY),
            }),
          ),
          STORAGE_PROBE_TIMEOUT_MS,
          "The storage probe timed out.",
        ),
      );
      checks.push(toCheck("PutObject", put));
      if (!put.ok) {
        return this.fail(base, checks, "PutObject", put.error);
      }
      needsCleanup = true;

      const get = await this.measure(async () => {
        const response = await withTimeout(
          internal.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
          STORAGE_PROBE_TIMEOUT_MS,
          "The storage probe timed out.",
        );
        const bytes = await response.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes).toString("utf8") : "";
      });
      checks.push(toCheck("GetObject", get));
      if (!get.ok) {
        return this.fail(base, checks, "GetObject", get.error);
      }
      if (get.value !== STORAGE_PROBE_BODY) {
        this.logger.warn({ stage: "GetObject" }, "storage.probe_read_mismatch");
        return {
          ...base,
          ok: false,
          checks,
          failedAt: "GetObject",
          code: "STORAGE_READ_MISMATCH",
          message:
            "The object was written but reading it back returned different bytes. Check for a CDN/proxy that rewrites bodies.",
        };
      }

      const presigned = await this.measure(async () => {
        const url = await getSignedUrl(
          signing,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: 60 },
        );
        const expectedHost = new URL(base.publicEndpoint).host;
        if (new URL(url).host !== expectedHost) {
          throw new StorageProbeError(
            "STORAGE_SIGNING_ENDPOINT_MISMATCH",
            "The presigned URL was not signed for the configured public endpoint.",
          );
        }
        const response = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(STORAGE_PROBE_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new StorageProbeError(
            "STORAGE_SIGNED_READ_FAILED",
            `The presigned URL was rejected with HTTP ${response.status}. Check the public endpoint, CORS and Host forwarding.`,
          );
        }
        return await response.text();
      });
      checks.push(toCheck("PresignedGet", presigned));
      if (!presigned.ok) {
        return this.fail(base, checks, "PresignedGet", presigned.error);
      }
      if (presigned.value !== STORAGE_PROBE_BODY) {
        return {
          ...base,
          ok: false,
          checks,
          failedAt: "PresignedGet",
          code: "STORAGE_SIGNED_READ_MISMATCH",
          message: "The presigned URL returned different bytes than the probe object.",
        };
      }

      const del = await this.measure(() =>
        withTimeout(
          internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
          STORAGE_PROBE_TIMEOUT_MS,
          "The storage probe timed out.",
        ),
      );
      checks.push(toCheck("DeleteObject", del));
      if (!del.ok) {
        return this.fail(base, checks, "DeleteObject", del.error);
      }
      needsCleanup = false;

      this.logger.log(
        { bucket, endpoint: base.endpoint, checks: checks.length },
        "storage.probe_succeeded",
      );
      return { ...base, ok: true, checks };
    } finally {
      if (needsCleanup) {
        try {
          await internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        } catch {
          // The response already names the failing step; cleanup is best-effort
          // and must not replace it. Never log the key (it is random, but still
          // an object coordinate).
          this.logger.warn({ bucket }, "storage.probe_cleanup_failed");
        }
      }
    }
  }

  private fail(
    base: StorageProbeBase,
    checks: StorageProbeCheck[],
    stage: StorageProbeCheck["name"],
    error: unknown,
  ): StorageProbeFailure {
    const { stage: _failedAt, ...detail } = classifyProbeFailure(stage, error);
    this.logger.warn(
      {
        stage,
        code: detail.code,
        checks: checks.length,
        bucket: base.bucket,
        endpoint: base.endpoint,
      },
      "storage.probe_failed",
    );
    return { ...base, ok: false, checks, failedAt: stage, ...detail };
  }

  private async measure<T>(operation: () => Promise<T>): Promise<MeasureResult<T>> {
    const startedAt = Date.now();
    try {
      const value = await operation();
      return { ok: true, value, ms: Math.max(0, Date.now() - startedAt) };
    } catch (error) {
      return { ok: false, error, ms: Math.max(0, Date.now() - startedAt) };
    }
  }
}

class StorageProbeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorageProbeError";
  }
}

function toCheck(name: StorageProbeCheck["name"], result: MeasureResult<unknown>): StorageProbeCheck {
  return { name, ok: result.ok, ms: result.ms };
}

function classifyConfigFailure(error: unknown): ProbeFailure {
  if (error instanceof StorageConfigurationError) {
    return { stage: "Config", code: error.code, message: error.message };
  }
  return {
    stage: "Config",
    code: "STORAGE_CONFIG_INVALID",
    message: "The effective storage configuration is incomplete.",
  };
}

const TRANSPORT_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UND_ERR_CONNECT_TIMEOUT",
]);

interface ErrorDetails {
  name?: string;
  code?: string;
  status?: number;
}

function errorDetails(error: unknown): ErrorDetails {
  if (!(error instanceof Error)) {
    return {};
  }
  const record = error as Error & {
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return {
    name: error.name,
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.$metadata?.httpStatusCode === "number"
      ? { status: record.$metadata.httpStatusCode }
      : {}),
  };
}

function isTransportFailure(details: ErrorDetails): boolean {
  return details.code !== undefined && TRANSPORT_CODES.has(details.code);
}

function classifyProbeFailure(stage: StorageProbeCheck["name"], error: unknown): ProbeFailure {
  if (error instanceof StorageProbeError) {
    return {
      stage,
      code: error.code,
      message: error.message,
      ...(error.code === "STORAGE_PUBLIC_ENDPOINT_UNREACHABLE"
        ? { publicEndpointUnreachable: true }
        : {}),
    };
  }

  const details = errorDetails(error);

  if (stage === "PresignedGet") {
    return {
      stage,
      code: "STORAGE_PUBLIC_ENDPOINT_UNREACHABLE",
      message:
        "The API could not fetch the presigned URL from the public endpoint. Check DNS, TLS and that the origin is reachable from the server; browser-side CORS is not covered here.",
      publicEndpointUnreachable: true,
    };
  }

  if (isTransportFailure(details)) {
    return {
      stage,
      code: "STORAGE_ENDPOINT_UNREACHABLE",
      message: `The endpoint could not be reached (${details.code ?? "network error"}). Check the endpoint, DNS, TLS and the container network.`,
    };
  }

  if (stage === "HeadBucket") {
    if (details.status === 404 || details.name === "NotFound" || details.name === "NoSuchBucket") {
      return {
        stage,
        code: "STORAGE_BUCKET_NOT_FOUND",
        message: "HeadBucket returned 404. Check the bucket name and that it exists in this region.",
      };
    }
    if (details.status === 403 || details.name === "AccessDenied" || details.name === "InvalidAccessKeyId" || details.name === "SignatureDoesNotMatch") {
      return {
        stage,
        code: "STORAGE_CREDENTIALS_REJECTED",
        message:
          "HeadBucket was rejected (403). Check the access key, secret key, region and the server clock.",
      };
    }
    if (details.name === "PermanentRedirect" || details.status === 301) {
      return {
        stage,
        code: "STORAGE_REGION_MISMATCH",
        message: "HeadBucket redirected. The endpoint and region do not match.",
      };
    }
    return {
      stage,
      code: "STORAGE_HEAD_BUCKET_FAILED",
      message: "HeadBucket failed. Check the endpoint, bucket and credentials.",
    };
  }

  if (stage === "PutObject") {
    if (details.status === 403) {
      return {
        stage,
        code: "STORAGE_WRITE_DENIED",
        message: "PutObject was denied (403). Check the access key's PutObject permission and the bucket policy.",
      };
    }
    if (details.name === "XAmzContentSHA256Mismatch" || details.name === "BadDigest" || details.name === "InvalidRequest") {
      return {
        stage,
        code: "STORAGE_CHECKSUM_REJECTED",
        message:
          "PutObject was rejected for its checksum. The endpoint is not compatible with the SDK checksum mode; keep WHEN_REQUIRED and verify the provider.",
      };
    }
    return {
      stage,
      code: "STORAGE_PUT_FAILED",
      message: "PutObject failed. Check write permissions and bucket policy.",
    };
  }

  if (stage === "GetObject") {
    return {
      stage,
      code: "STORAGE_READ_FAILED",
      message: "GetObject failed. Check read permissions and bucket policy.",
    };
  }

  return {
    stage,
    code: "STORAGE_DELETE_FAILED",
    message: "DeleteObject failed. Check delete permissions; the probe object may remain in the bucket.",
  };
}