import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

import type { StorageSettings } from "../../config/storage-settings.js";

/**
 * Browser-facing origin used to sign presigned URLs.
 *
 * SigV4 signs the `Host` header, so this must be the origin the browser will
 * actually request; an empty/blank value falls back to the internal endpoint
 * (single-endpoint local/staging setups).
 */
export function resolveSigningEndpoint(settings: StorageSettings): string {
  const configured = settings.publicEndpoint?.trim();
  const endpoint = configured && configured.length > 0 ? configured : settings.endpoint;
  return normalizedEndpoint(endpoint);
}

export function normalizedEndpoint(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

/**
 * Builds an S3 client. `endpoint` overrides `settings.endpoint` so the signing
 * client can point at the browser-facing origin while the internal client keeps
 * talking to the container network.
 *
 * `requestChecksumCalculation` / `responseChecksumValidation` are pinned to
 * `WHEN_REQUIRED`: AWS SDK v3.729+ otherwise sends CRC32 headers that R2, older
 * MinIO and some B2/Wasabi deployments reject. The probe deliberately exercises
 * PutObject so a deployment with an incompatible endpoint is reported instead
 * of failing only on the first real upload.
 */
export function createS3Client(settings: StorageSettings, endpoint?: string): S3Client {
  const clientConfig: S3ClientConfig = {
    endpoint: endpoint ?? settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };

  return new S3Client(clientConfig);
}

export interface BuiltStorageClients {
  readonly internal: S3Client;
  readonly public: S3Client;
}

export type StorageClientBuilder = (
  settings: StorageSettings,
  signingEndpoint: string,
) => BuiltStorageClients;

/** Default builder; tests inject their own through `STORAGE_CLIENT_BUILDER`. */
export const buildStorageClients: StorageClientBuilder = (settings, signingEndpoint) => ({
  internal: createS3Client(settings),
  public: createS3Client(settings, signingEndpoint),
});