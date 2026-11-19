import type { MediaExif } from "@roamlog/contracts";

import { shortDateLabel } from "@/components/trip-workspace/format";

/**
 * The two display layers of the photo metadata (0014).
 *
 * Ported from `.audit/research-exif-metadata.md` §4.2 ("展示分级") and §10.1,
 * with the grouping taken from LibrePhotos' `CameraInfoSection` /
 * Immich's `DetailPanel`: the card gets two or three information points, the
 * detail surface gets the camera block, the exposure chips and the capture time.
 *
 * Rules the research report calls out explicitly, and this file enforces:
 * - a value that is `null` / `0` / `"----"` / `"Unknown"` is **hidden**, never
 *   rendered as a placeholder;
 * - nothing is formatted from a raw EXIF fraction at the database level — the
 *   values are numeric/text and become `ƒ/1.8`, `1/250 s`, `24mm` only here;
 * - the camera name is de-duplicated (`Make=Apple, Model=iPhone 15 Pro` must not
 *   print as "Apple Apple iPhone 15 Pro").
 */

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/** Trailing-zero-free number, so `1.80` prints as `1.8` and `2.0` as `2`. */
function decimal(value: number, digits = 1): string {
  return String(Number(value.toFixed(digits)));
}

/** `1.8` → `ƒ/1.8`, `2` → `ƒ/2`. */
export function formatAperture(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `ƒ/${decimal(value)}`
    : null;
}

/** `24` → `24mm`; a 35mm-equivalent is the fallback when the real one is absent. */
export function formatFocalLength(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${decimal(value, 0)}mm`
    : null;
}

/** `"1/250"` → `1/250 s`, `"2.5"` → `2.5 s`. */
export function formatExposureTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? `${trimmed} s` : null;
}

/**
 * Product lines that already name their maker, so printing the maker again is
 * noise rather than information.
 *
 * The research report's expected card label is `iPhone 15 Pro` for
 * `Make=Apple, Model=iPhone 15 Pro` (§4.2), which plain de-duplication cannot
 * reach: Apple's model strings never contain "Apple". Same shape for Google
 * (`Pixel 8`) and Samsung (`Galaxy S24`). This is a lookup, not brand guessing:
 * any maker absent from the table keeps the `Make Model` form verbatim.
 */
const MAKER_IMPLIED_BY_MODEL: Record<string, readonly string[]> = {
  apple: ["iphone", "ipad", "ipod", "macbook", "imac", "mac "],
  google: ["pixel"],
  samsung: ["galaxy"],
};

function modelNamesItsMaker(make: string, model: string): boolean {
  const lowerMake = make.toLowerCase();
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes(lowerMake)) {
    return true;
  }
  const implied = MAKER_IMPLIED_BY_MODEL[lowerMake];
  return implied?.some((prefix) => lowerModel.startsWith(prefix)) ?? false;
}

/**
 * The `Make` + `Model` pair as one short label.
 *
 * The de-duplication rule is the portable part of Immich's camera name and
 * LibrePhotos' camera string: when the model already names the maker — directly
 * or through its product line — printing the maker again is noise.
 */
export function formatCameraName(exif: MediaExif | null | undefined): string | null {
  if (!exif) {
    return null;
  }
  const make = exif.Make?.trim() ?? "";
  const model = exif.Model?.trim() ?? "";
  if (!make) return model.length > 0 ? model : null;
  if (!model) return make;
  return modelNamesItsMaker(make, model) ? model : `${make} ${model}`;
}

/** The lens label: `LensModel`, falling back to the maker alone. */
export function formatLensName(exif: MediaExif | null | undefined): string | null {
  const model = exif?.LensModel?.trim();
  if (model) {
    return model;
  }
  const make = exif?.LensMake?.trim();
  return make && make.length > 0 ? make : null;
}

/**
 * The single exposure value the card shows: `ƒ/1.8 · 24mm`.
 *
 * Aperture first, then focal length — the pair the research report picks as the
 * most recognisable two-value signature. `null` when neither is readable, so the
 * card simply renders one line fewer instead of an empty separator.
 */
export function formatExposureSummary(exif: MediaExif | null | undefined): string | null {
  if (!exif) {
    return null;
  }
  const parts = [
    formatAperture(exif.FNumber),
    formatFocalLength(exif.FocalLength ?? exif.FocalLengthIn35mmFormat),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The capture date as `11月2日`, preferring the row's own date over EXIF. */
export function formatCaptureDate(
  date: string | null | undefined,
  exif: MediaExif | null | undefined,
): string | null {
  if (typeof date === "string" && date.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    return shortDateLabel(date.slice(0, 10));
  }
  const taken = exif?.DateTimeOriginal?.slice(0, 10);
  return taken && /^\d{4}-\d{2}-\d{2}$/.test(taken) ? shortDateLabel(taken) : null;
}

const CAPTURE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO 8601 → `2026年11月19日 19:43`; `null` when there is no usable timestamp. */
export function formatCaptureTime(exif: MediaExif | null | undefined): string | null {
  const iso = exif?.DateTimeOriginal;
  if (typeof iso !== "string") {
    return null;
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : CAPTURE_TIME_FORMATTER.format(parsed);
}

/** `true` when the photo carries a usable WGS-84 pair. */
export function hasExactLocation(exif: MediaExif | null | undefined): boolean {
  return (
    typeof exif?.latitude === "number" &&
    Number.isFinite(exif.latitude) &&
    typeof exif?.longitude === "number" &&
    Number.isFinite(exif.longitude)
  );
}

export interface MediaExifSummaryProps {
  exif: MediaExif | null | undefined;
  /** Row date (`Media.date`); EXIF's capture date is the fallback. */
  date?: string | null;
  /**
   * Overrides the "has a position" marker. The marker stays independent of the
   * Owner's public-share switch: it tells a member that a photo *can* be placed
   * on the map, which is true whether or not a share link exposes the point.
   */
  hasLocation?: boolean;
  className?: string;
}

/**
 * L1 — the card line: date, camera short name, and (wide screens only) one
 * exposure value.
 *
 * The exposure value is `hidden sm:inline` on purpose: the research report caps
 * the card at "date + camera" on a phone and adds the exposure signature only
 * where there is room.
 */
export function MediaExifSummary({ exif, date, hasLocation, className }: MediaExifSummaryProps) {
  const captureDate = formatCaptureDate(date, exif);
  const camera = formatCameraName(exif);
  const exposure = formatExposureSummary(exif);
  const located = hasLocation ?? hasExactLocation(exif);
  if (!captureDate && !camera && !exposure && !located) {
    return null;
  }
  return (
    <div className={cx("flex flex-col gap-0.5", className)} data-testid="media-exif-summary">
      <div className="flex items-center gap-2">
        {captureDate ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted">
            {captureDate}
          </span>
        ) : null}
        {located ? (
          <span
            className="rounded-full border border-white/15 px-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-stone"
            title="这张照片含拍摄位置"
          >
            有位置
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2 text-xs text-white/80">
        {camera ? <span className="truncate">{camera}</span> : null}
        {exposure ? (
          <span className="hidden shrink-0 font-mono text-[10px] text-stone sm:inline">
            {exposure}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface MediaExifDetailProps {
  exif: MediaExif | null | undefined;
  /** Row date (`Media.date`); EXIF's capture date is the fallback. */
  date?: string | null;
  className?: string;
}

/**
 * L2 — the photo detail surface: the camera/lens block, the exposure chips
 * (`ISO / 焦距 / 光圈 / 快门`, the research report's order) and the capture time.
 *
 * Renders nothing when the photo has no metadata, so a screenshot or a stripped
 * export shows an empty section rather than a grid of dashes.
 */
export function MediaExifDetail({ exif, date, className }: MediaExifDetailProps) {
  const camera = formatCameraName(exif);
  const lens = formatLensName(exif);
  const captureTime = formatCaptureTime(exif);
  const chips = [
    typeof exif?.ISO === "number" ? `ISO ${exif.ISO}` : null,
    formatFocalLength(exif?.FocalLength ?? exif?.FocalLengthIn35mmFormat),
    formatAperture(exif?.FNumber),
    formatExposureTime(exif?.ExposureTime),
  ].filter((chip): chip is string => chip !== null);
  const fallbackDate = captureTime ? null : formatCaptureDate(date, exif);
  if (!camera && !lens && chips.length === 0 && !captureTime && !fallbackDate) {
    return null;
  }
  return (
    <div className={cx("flex flex-col gap-3", className)} data-testid="media-exif-detail">
      {camera || lens ? (
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">相机</p>
          {camera ? <p className="text-sm text-white/85">{camera}</p> : null}
          {lens ? <p className="text-xs leading-5 text-muted">{lens}</p> : null}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="曝光参数">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-white/75"
            >
              {chip}
            </li>
          ))}
        </ul>
      ) : null}
      {captureTime || fallbackDate ? (
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">拍摄时间</p>
          <p className="font-mono text-[11px] text-white/75">{captureTime ?? fallbackDate}</p>
        </div>
      ) : null}
    </div>
  );
}
