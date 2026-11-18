/**
 * Resolved object-storage configuration.
 *
 * Two endpoints are intentional, because SigV4 presigned URLs sign the `Host`
 * header:
 *
 * - `endpoint` is what the API/worker actually talk to (head/delete/health and
 *   every server-side S3 call). In production this is the internal Docker DNS
 *   name, e.g. `http://minio:9000`.
 * - `publicEndpoint` is what the *browser* talks to. Presigned URLs (GET for
 *   reads, PUT for uploads) are signed against this origin, so the Nginx media
 *   server in front of MinIO must preserve the `Host` header; rewriting the URL
 *   host after signing invalidates the signature.
 *
 * `publicEndpoint` is optional so a single-endpoint local/staging setup keeps
 * working; {@link StorageService} falls back to `endpoint` when it is unset.
 */
export interface StorageSettings {
  /** Internal S3 API endpoint (never handed to a browser). */
  endpoint: string;

  /**
   * Browser-reachable origin used ONLY to presign URLs. Empty/undefined means
   * "same as `endpoint`" (local development, staging).
   */
  publicEndpoint?: string;

  /**
   * Optional unsigned public object base URL (e.g. a CDN origin). Reserved:
   * nothing in the API serves objects through it yet, and private media must
   * keep using presigned URLs, so no code path reads this value.
   */
  publicBaseUrl?: string;

  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  forcePathStyle: boolean;

  /** Default TTL for signed URLs when a caller does not pass one. */
  signedUrlTtlSeconds: number;

  /**
   * Media-specific default TTL (`MEDIA_SIGNED_URL_TTL_SECONDS`). When set it
   * wins over `signedUrlTtlSeconds` for both presigned reads and uploads.
   */
  mediaSignedUrlTtlSeconds?: number;
}