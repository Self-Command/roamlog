import { MediaExifSchema, type MediaExif } from "@roamlog/contracts";

/**
 * Reads the curated photo EXIF off the **source** `File`, before compression.
 *
 * Order matters and is not an optimisation: the upload pipeline redraws the
 * source through a canvas and encodes a fresh WebP, and a canvas re-encode
 * carries none of the source EXIF — while the original is never uploaded. So the
 * RAW `File` handled here is the only place the camera data exists at all (see
 * `.audit/research-exif-metadata.md` §5.1/§5.3; Immich/PhotoPrism/LibrePhotos
 * all read EXIF server-side because they keep an original, which this pipeline
 * deliberately does not do).
 *
 * Ported from the research report §4.2 (curated ~45 fields), §4.3 (normalize
 * values, never store display strings) and §5.3 (never block the upload).
 *
 * Guarantees:
 * - **Never throws.** A corrupt, truncated, huge or EXIF-less file is a normal
 *   outcome and resolves to `null`; an upload must not fail over metadata.
 * - **Never blocks.** Past `timeoutMs` the read is abandoned and the upload
 *   continues without the data (exifr 7 has no abort hook, so the underlying
 *   read may finish in the background; nothing awaits it).
 * - **Bounded.** Files over `maxBytes` are skipped outright.
 * - **Typed and sanitized.** The result is validated field by field against
 *   {@link MediaExifSchema}, so a bad tag drops that one field instead of the
 *   whole snapshot, and nothing outside the curated key set is ever returned.
 */

/** Default ceiling; a 50 MB+ RAW is not worth parsing metadata from. */
export const PHOTO_EXIF_MAX_BYTES = 64 * 1024 * 1024;
/** Default deadline; the user is waiting on the upload, not on EXIF. */
export const PHOTO_EXIF_TIMEOUT_MS = 4_000;

export interface PhotoExifRead {
  /** Curated snapshot, `exifr` tag names, normalized values. */
  exif: MediaExif;
  /** WGS-84 pair lifted out for the map columns; both or neither. */
  lat: number | null;
  lng: number | null;
}

/** Test/embedding seam; production lazily imports `exifr`. */
export type PhotoExifParser = (file: File, options: Record<string, unknown>) => Promise<unknown>;

/** A reader as the upload hooks consume it. */
export type PhotoExifReader = (file: File) => Promise<PhotoExifRead | null>;

/**
 * Runs a reader so that metadata can never fail an upload.
 *
 * {@link readPhotoExif} already resolves `null` instead of throwing, but the
 * reader is an injectable seam (and every caller passes it through), so the
 * "metadata is a bonus, never a precondition" rule is enforced at the call site
 * too rather than trusted from a distance.
 */
export async function readPhotoExifSafely(
  reader: PhotoExifReader,
  file: File,
): Promise<PhotoExifRead | null> {
  try {
    return await reader(file);
  } catch {
    return null;
  }
}

export interface ReadPhotoExifOptions {
  timeoutMs?: number;
  maxBytes?: number;
  parse?: PhotoExifParser;
}

/**
 * exifr options. Deliberately narrow: thumbnails, MakerNote, ICC and XMP are
 * skipped (binary blobs this feature neither stores nor shows), which keeps the
 * read cheap and the output to the tags we actually curate.
 */
const EXIFR_OPTIONS: Record<string, unknown> = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  interop: false,
  makerNote: false,
  userComment: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  mergeOutput: true,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  silentErrors: true,
};

async function defaultParse(file: File, options: Record<string, unknown>): Promise<unknown> {
  const exifr = await import("exifr");
  return (await exifr.parse(file, options)) ?? null;
}

export async function readPhotoExif(
  file: File,
  options: ReadPhotoExifOptions = {},
): Promise<PhotoExifRead | null> {
  const maxBytes = options.maxBytes ?? PHOTO_EXIF_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? PHOTO_EXIF_TIMEOUT_MS;
  if (!file || file.size <= 0 || file.size > maxBytes) {
    return null;
  }

  const parse = options.parse ?? defaultParse;
  let raw: unknown;
  try {
    raw = await withTimeout(parse(file, EXIFR_OPTIONS), timeoutMs);
  } catch {
    // Unreadable metadata is not an upload failure. The photo just has none.
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const exif = sanitizeExif({
    Make: text(source.Make),
    Model: text(source.Model),
    LensMake: text(source.LensMake),
    LensModel: text(source.LensModel),
    Software: text(source.Software),
    Artist: text(source.Artist),
    Copyright: text(source.Copyright),
    OwnerName: text(source.OwnerName),
    BodySerialNumber: text(source.BodySerialNumber),
    LensSerialNumber: text(source.LensSerialNumber),

    FNumber: positive(source.FNumber, 128),
    ExposureTime: exposureTime(source.ExposureTime),
    ISO: integer(source.ISO, 1_000_000),
    FocalLength: positive(source.FocalLength, 2_000),
    FocalLengthIn35mmFormat: positive(
      source.FocalLengthIn35mmFormat ?? source.FocalLengthIn35mmFilm,
      2_000,
    ),
    ExposureCompensation: bounded(source.ExposureCompensation, -20, 20),
    ExposureProgram: label(source.ExposureProgram),
    ExposureMode: label(source.ExposureMode),
    Flash: flash(source.Flash),
    WhiteBalance: label(source.WhiteBalance),
    MeteringMode: label(source.MeteringMode),
    LightSource: label(source.LightSource),
    SceneCaptureType: label(source.SceneCaptureType),
    DigitalZoomRatio: bounded(source.DigitalZoomRatio, 0, 100),
    SubjectDistance: bounded(source.SubjectDistance, 0, 100_000),

    DateTimeOriginal: isoDate(source.DateTimeOriginal),
    CreateDate: isoDate(source.CreateDate),
    ModifyDate: isoDate(source.ModifyDate),
    OffsetTimeOriginal: offset(source.OffsetTimeOriginal),
    OffsetTime: offset(source.OffsetTime),
    SubSecTimeOriginal: text(source.SubSecTimeOriginal),
    GPSDateTime: isoDate(source.GPSDateTime),

    Orientation: orientation(source.Orientation),
    ColorSpace: label(source.ColorSpace),
    ExifImageWidth: integer(source.ExifImageWidth ?? source.PixelXDimension, 20_000),
    ExifImageHeight: integer(source.ExifImageHeight ?? source.PixelYDimension, 20_000),
    XResolution: positive(source.XResolution, Number.MAX_SAFE_INTEGER),
    YResolution: positive(source.YResolution, Number.MAX_SAFE_INTEGER),
    ResolutionUnit: label(source.ResolutionUnit),
    BitsPerSample: integer(source.BitsPerSample, 64),

    latitude: coordinate(source.latitude ?? source.GPSLatitude, 90),
    longitude: coordinate(source.longitude ?? source.GPSLongitude, 180),
    GPSLatitude: coordinate(source.GPSLatitude, 90),
    GPSLongitude: coordinate(source.GPSLongitude, 180),
    GPSAltitude: bounded(source.GPSAltitude, -1_000, 20_000),
    GPSAltitudeRef: label(source.GPSAltitudeRef),
    GPSImgDirection: bounded(source.GPSImgDirection, 0, 360),
    GPSImgDirectionRef: text(source.GPSImgDirectionRef),
    GPSHPositioningError: bounded(source.GPSHPositioningError, 0, 1_000_000),
    GPSProcessingMethod: text(source.GPSProcessingMethod),
  });

  const lat = exif.latitude ?? null;
  const lng = exif.longitude ?? null;
  const hasPosition = lat !== null && lng !== null;
  return { exif, lat: hasPosition ? lat : null, lng: hasPosition ? lng : null };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EXIF_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("EXIF_READ_FAILED"));
      },
    );
  });
}

/** Structural view of a single Zod field, so this module needs no zod import. */
type FieldSchema = {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
};

/**
 * Validates one field at a time.
 *
 * Whole-object validation would be all-or-nothing: one camera writing
 * `FNumber: 0` would discard the GPS, the timestamp and the model with it. Each
 * field is checked against its own rule instead, so an out-of-range tag becomes
 * `null` and the rest of the snapshot survives — the same leniency
 * `presentMediaExif` applies on the read path.
 */
function sanitizeExif(candidate: Record<string, unknown>): MediaExif {
  const shape = (MediaExifSchema as unknown as { shape: Record<string, FieldSchema> }).shape;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const value = candidate[key] ?? null;
    const parsed = shape[key]?.safeParse(value);
    output[key] = parsed?.success ? (parsed.data ?? null) : null;
  }
  return output as MediaExif;
}

/** Text tag: trimmed, control characters stripped, empty collapses to `null`. */
function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = stripControlCharacters(value).replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The characters the old `[\u0000-\u001f\u007f]` class matched: C0 plus DEL.
 *
 * Asked as a code-point predicate because `no-control-regex` rejects the escaped
 * range outright, and a rule that fires on a correct regex is better answered by
 * saying the same thing in code than by suppressing it. Each hit becomes a space
 * so the caller's `\s+` collapse folds runs of them into one separator.
 */
function isControlCodePoint(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

function stripControlCharacters(value: string): string {
  let cleaned = "";
  for (const character of value) {
    cleaned += isControlCodePoint(character.codePointAt(0) ?? 0) ? " " : character;
  }
  return cleaned;
}

/** EXIF enum tags arrive as dictionary labels; a raw code is kept verbatim. */
function label(value: unknown): string | null {
  return text(value);
}

function finite(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) {
    // GPS DMS arrives as `[deg, min, sec]`, sometimes as `[[d,1],[m,1],[s,1]]`.
    const parts = value.map((part) =>
      Array.isArray(part) ? (typeof part[0] === "number" ? part[0] : Number.NaN) : part,
    );
    if (parts.some((part) => typeof part !== "number" || !Number.isFinite(part))) {
      return null;
    }
    const [degrees = 0, minutes = 0, seconds = 0] = parts as number[];
    const sign = degrees < 0 ? -1 : 1;
    return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
  }
  return null;
}

function bounded(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null;
}

function positive(value: unknown, max: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 && parsed <= max ? parsed : null;
}

function integer(value: unknown, max: number): number | null {
  const parsed = finite(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function coordinate(value: unknown, bound: number): number | null {
  const parsed = finite(value);
  if (parsed === null || Math.abs(parsed) > bound) {
    return null;
  }
  // (0, 0) is the classic "no fix" artefact; publishing it as a position would
  // put the photo in the Gulf of Guinea.
  return parsed === 0 ? null : parsed;
}

/** `GPSImgDirection`/`Orientation` need their own ranges, not the generic ones. */
function orientation(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : null;
}

/**
 * Normalizes a shutter speed to the conventional `"1/250"` text.
 *
 * exifr hands back seconds as a number (`0.004`) for some files and an already
 * formatted fraction for others; both collapse to the same text here, because
 * the stored value has to be stable regardless of which path the file took.
 */
function exposureTime(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes("/")) {
      const [numerator, denominator] = trimmed.split("/");
      const top = Number.parseFloat(numerator ?? "");
      const bottom = Number.parseFloat(denominator ?? "");
      if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0) {
        return top === 1 ? `1/${Math.round(bottom)}` : `${top}/${Math.round(bottom)}`;
      }
      return null;
    }
  }
  const seconds = finite(value);
  if (seconds === null || seconds <= 0) {
    return null;
  }
  if (seconds >= 1) {
    return String(Math.round(seconds * 10) / 10);
  }
  return `1/${Math.round(1 / seconds)}`;
}

/**
 * `Flash` is stored as a boolean (the research model, §4.3) even though exifr
 * revives it to an English sentence: bit 0 of the raw tag is "the flash fired",
 * and the sentence is a display concern.
 */
function flash(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value & 1) === 1 : null;
  }
  if (typeof value === "string") {
    if (/did not fire|no flash function|not fired/i.test(value)) {
      return false;
    }
    if (/fired/i.test(value)) {
      return true;
    }
  }
  return null;
}

function offset(value: unknown): string | null {
  const asText = text(value);
  return asText !== null && /^[+-]\d{2}:\d{2}$/.test(asText) ? asText : null;
}

/**
 * Timestamps become ISO 8601 UTC strings.
 *
 * exifr revives these tags to `Date`. A `Date` has no time zone of its own, so
 * the EXIF wall clock is interpreted as UTC — `OffsetTimeOriginal` is stored
 * separately and is what a future timezone-aware display should use.
 */
function isoDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const asText = text(value);
  if (asText === null) {
    return null;
  }
  const parsed = Date.parse(asText);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
