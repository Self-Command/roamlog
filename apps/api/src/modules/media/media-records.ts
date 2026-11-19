import type { MediaStatus } from "@roamlog/contracts";

/**
 * The paired motion asset columns. Mirrors `MediaMotion` in the schema; the
 * presenter is the only place these rows become contract objects, and it never
 * exposes `storageKey`/`thumbKey`.
 */
export interface MediaMotionRecord {
  id: string;
  mediaId: string;
  storageKey: string;
  thumbKey: string | null;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface MediaRecord {
  id: string;
  workspaceId: string;
  tripId: string | null;
  uploaderId: string;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  variants: unknown;
  status: MediaStatus;
  error: string | null;
  caption: string | null;
  date: Date | null;
  location: string | null;
  /**
   * Curated EXIF snapshot (0014), written once by `complete` from what the
   * browser read off the source file before compressing it. `null` for media
   * whose metadata could not be read — never a placeholder object.
   */
  exif: unknown;
  /** WGS-84 pair denormalized out of `exif` for map queries; both or neither. */
  lat: number | null;
  lng: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /**
   * Present only when the row was loaded with its `motion` relation. `null`
   * (or absent) means "ordinary image": the API reports `livePhoto: false`.
   */
  motion?: MediaMotionRecord | null;
}