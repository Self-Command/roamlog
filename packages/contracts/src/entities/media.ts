import { z } from "zod";

import {
  DateOnlySchema,
  IsoTimestampSchema,
  JsonObjectSchema,
  UuidV7Schema,
} from "../common/ids";
import { MediaStatusSchema } from "./enums";

/**
 * Container types a paired motion asset may use.
 *
 * iOS records `video/quicktime` (HEVC in a `.mov`); the worker may transcode to
 * `video/mp4` for browsers that cannot play HEVC, so both are accepted by the
 * contract and by the database CHECK.
 */
export const MEDIA_MOTION_MIME_TYPES = ["video/quicktime", "video/mp4"] as const;
export const MediaMotionMimeTypeSchema = z.enum(MEDIA_MOTION_MIME_TYPES);
export type MediaMotionMimeType = (typeof MEDIA_MOTION_MIME_TYPES)[number];

/**
 * The paired motion asset of a Live Photo, as the API exposes it.
 *
 * `url` is a signed read URL with the same expiry semantics as the still's
 * `url`/`thumbUrl`; the bucket, the storage key and the thumbnail key never
 * leave the server. `url` is `null` while nothing has been signed yet (for
 * example while the still is still processing), which is why the whole object
 * is nullable on `Media` rather than an object with empty fields.
 */
export const MediaMotionSchema = z
  .object({
    url: z.url().nullable().describe("Signed motion URL (video), same expiry as `expiresAt`."),
    mimeType: MediaMotionMimeTypeSchema,
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type MediaMotion = z.infer<typeof MediaMotionSchema>;

/**
 * The curated EXIF snapshot of a photo (~45 tags).
 *
 * Ported from `.audit/research-exif-metadata.md` §4.2/§4.3/§5.3. The reason it
 * exists at all is the upload pipeline: the browser re-encodes the source `File`
 * through a canvas before uploading, and a canvas re-encode carries none of the
 * source EXIF — while the original is never uploaded either. Immich,
 * PhotoPrism and LibrePhotos can all read EXIF *server-side* because they keep
 * the original; this pipeline deliberately does not, so the metadata has exactly
 * one chance to survive: read in the browser from the raw `File`, before
 * `compress()`, and submitted with the existing `complete` callback.
 *
 * Keys keep the `exifr` tag names, so what the reader saw and what the API
 * stored are directly comparable. Values are normalized, not raw: timestamps are
 * ISO 8601 strings, `Flash` is a boolean, `ExposureTime` is the conventional
 * `"1/250"` text, and enum-ish tags carry their EXIF dictionary label. Display
 * strings (`ƒ/1.8 · 24mm`) are never stored — the UI formats at render time, so
 * changing a format never needs a data migration.
 *
 * Deliberately **not** `.strict()`, and every key is optional as well as
 * nullable. This blob is written by a browser bundle that can be newer than the
 * API during a rollout, and read back from rows written by an older schema. A
 * strict, all-required object would turn "one added tag" into a 400 on
 * `complete`, or a 500 on every read of a pre-existing row. Unknown keys are
 * stripped instead, so nothing unvetted is ever persisted. `null` means "the
 * file did not carry this"; the reader always emits the full snapshot, and a
 * photo with no readable metadata gets `exif: null` rather than a fake one.
 */
export const MediaExifSchema = z
  .object({
    // Camera, lens, authorship.
    Make: z.string().max(120).nullable().optional(),
    Model: z.string().max(120).nullable().optional(),
    LensMake: z.string().max(120).nullable().optional(),
    LensModel: z.string().max(200).nullable().optional(),
    Software: z.string().max(200).nullable().optional(),
    Artist: z.string().max(200).nullable().optional(),
    Copyright: z.string().max(200).nullable().optional(),
    OwnerName: z.string().max(200).nullable().optional(),
    BodySerialNumber: z.string().max(120).nullable().optional(),
    LensSerialNumber: z.string().max(120).nullable().optional(),
    // Exposure.
    FNumber: z.number().positive().max(128).nullable().optional(),
    ExposureTime: z.string().max(32).nullable().optional(),
    ISO: z.number().int().positive().max(1_000_000).nullable().optional(),
    FocalLength: z.number().positive().max(2_000).nullable().optional(),
    FocalLengthIn35mmFormat: z.number().positive().max(2_000).nullable().optional(),
    ExposureCompensation: z.number().min(-20).max(20).nullable().optional(),
    ExposureProgram: z.string().max(64).nullable().optional(),
    ExposureMode: z.string().max(64).nullable().optional(),
    Flash: z.boolean().nullable().optional(),
    WhiteBalance: z.string().max(32).nullable().optional(),
    MeteringMode: z.string().max(64).nullable().optional(),
    LightSource: z.string().max(64).nullable().optional(),
    SceneCaptureType: z.string().max(64).nullable().optional(),
    DigitalZoomRatio: z.number().nonnegative().max(100).nullable().optional(),
    SubjectDistance: z.number().min(0).max(100_000).nullable().optional(),
    // Time. `OffsetTimeOriginal` is the capture time zone, kept as text so a
    // photo keeps the local wall clock it was shot at.
    DateTimeOriginal: IsoTimestampSchema.nullable().optional(),
    CreateDate: IsoTimestampSchema.nullable().optional(),
    ModifyDate: IsoTimestampSchema.nullable().optional(),
    OffsetTimeOriginal: z
      .string()
      .regex(/^[+-]\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    OffsetTime: z
      .string()
      .regex(/^[+-]\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    SubSecTimeOriginal: z.string().max(16).nullable().optional(),
    GPSDateTime: IsoTimestampSchema.nullable().optional(),
    // Image description.
    Orientation: z.number().int().min(1).max(8).nullable().optional(),
    ColorSpace: z.string().max(64).nullable().optional(),
    ExifImageWidth: z.number().int().positive().max(20_000).nullable().optional(),
    ExifImageHeight: z.number().int().positive().max(20_000).nullable().optional(),
    XResolution: z.number().positive().nullable().optional(),
    YResolution: z.number().positive().nullable().optional(),
    ResolutionUnit: z.string().max(32).nullable().optional(),
    BitsPerSample: z.number().int().positive().max(64).nullable().optional(),
    // GPS. WGS-84 always; a projected CRS is never stored here.
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    GPSLatitude: z.number().min(-90).max(90).nullable().optional(),
    GPSLongitude: z.number().min(-180).max(180).nullable().optional(),
    GPSAltitude: z.number().min(-1_000).max(20_000).nullable().optional(),
    GPSAltitudeRef: z.string().max(32).nullable().optional(),
    GPSImgDirection: z.number().min(0).max(360).nullable().optional(),
    GPSImgDirectionRef: z.string().max(8).nullable().optional(),
    GPSHPositioningError: z.number().nonnegative().max(1_000_000).nullable().optional(),
    GPSProcessingMethod: z.string().max(120).nullable().optional(),
  })
  .describe("Curated photo EXIF (~45 tags), using the exifr tag names.");
export type MediaExif = z.infer<typeof MediaExifSchema>;

export const MediaSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    tripId: UuidV7Schema.nullable(),
    uploaderId: UuidV7Schema,
    bucket: z.string().min(1).max(120),
    key: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().nonnegative(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    blurhash: z.string().max(200).nullable(),
    variants: JsonObjectSchema,
    status: MediaStatusSchema,
    error: z.string().max(1000).nullable(),
    caption: z.string().max(500).nullable(),
    date: DateOnlySchema.nullable(),
    location: z.string().max(200).nullable(),
    /**
     * Curated EXIF read from the source file before compression (0014).
     * Optional so the admin presenter and pre-EXIF fixtures keep parsing — the
     * same escape hatch `moderatedAt` and `livePhoto` use; the media presenter
     * always emits it. `null` for media whose metadata could not be read (an
     * older photo, a screenshot, a corrupt file) — never a fabricated value.
     */
    exif: MediaExifSchema.nullable().optional(),
    /**
     * Denormalized WGS-84 position, lifted out of `exif` so a map query does not
     * parse JSON. Always written as a pair with `lng`, or both left `null`.
     */
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    deletedAt: IsoTimestampSchema.nullable(),
    /** Admin takedown marker; `deletedAt` remains the author's own delete. */
    moderatedAt: IsoTimestampSchema.nullable().optional(),
    moderatedById: UuidV7Schema.nullable().optional(),
    /**
     * `true` exactly when a live (non-deleted) motion row is paired with this
     * still. Optional so pre-Live-Photo fixtures and older clients keep parsing;
     * the API always sends it.
     */
    livePhoto: z
      .boolean()
      .optional()
      .describe("Whether a paired motion asset exists for this still."),
    motion: MediaMotionSchema.nullable()
      .optional()
      .describe("Paired motion asset; `null` for an ordinary image."),
  })
  .strict();
export type Media = z.infer<typeof MediaSchema>;