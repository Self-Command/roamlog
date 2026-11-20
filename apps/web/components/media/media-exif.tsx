"use client";

import type { MediaExif } from "@roamlog/contracts";
import { useState } from "react";

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
 *
 * The detail surface renders **all 50 curated fields** in the five groups the
 * schema itself documents (10 + 15 + 7 + 8 + 10), instead of the 8 it used to
 * show. Only fields that actually carry a value are rendered, so the sparse
 * object the API returns (it drops `null`s) never paints a grid of dashes.
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

// ---------------------------------------------------------------------------
// The 50 curated fields, grouped exactly as the schema documents them.
// ---------------------------------------------------------------------------

export interface MediaExifFieldSpec {
  key: keyof MediaExif;
  label: string;
}

export interface MediaExifGroupSpec {
  key: string;
  title: string;
  /** One line explaining what the group answers; never a placeholder. */
  description: string;
  fields: readonly MediaExifFieldSpec[];
}

/**
 * The five groups of `MediaExifSchema` (10 / 15 / 7 / 8 / 10 = 50).
 *
 * Keys are exifr tag names, so this list can be diffed against
 * `packages/contracts/src/entities/media.ts` and against
 * `apps/web/lib/image/read-photo-exif.ts` without translation.
 */
export const EXIF_FIELD_GROUPS: readonly MediaExifGroupSpec[] = [
  {
    key: "camera",
    title: "相机 / 镜头 / 署名",
    description: "设备与作者信息",
    fields: [
      { key: "Make", label: "相机品牌" },
      { key: "Model", label: "相机型号" },
      { key: "LensMake", label: "镜头品牌" },
      { key: "LensModel", label: "镜头型号" },
      { key: "Software", label: "处理软件" },
      { key: "Artist", label: "作者" },
      { key: "Copyright", label: "版权" },
      { key: "OwnerName", label: "相机所有者" },
      { key: "BodySerialNumber", label: "机身序列号" },
      { key: "LensSerialNumber", label: "镜头序列号" },
    ],
  },
  {
    key: "exposure",
    title: "曝光",
    description: "拍摄时的光学与测光参数",
    fields: [
      { key: "FNumber", label: "光圈" },
      { key: "ExposureTime", label: "快门" },
      { key: "ISO", label: "感光度" },
      { key: "FocalLength", label: "焦距" },
      { key: "FocalLengthIn35mmFormat", label: "等效焦距" },
      { key: "ExposureCompensation", label: "曝光补偿" },
      { key: "ExposureProgram", label: "曝光程序" },
      { key: "ExposureMode", label: "曝光模式" },
      { key: "Flash", label: "闪光灯" },
      { key: "WhiteBalance", label: "白平衡" },
      { key: "MeteringMode", label: "测光模式" },
      { key: "LightSource", label: "光源" },
      { key: "SceneCaptureType", label: "场景类型" },
      { key: "DigitalZoomRatio", label: "数码变焦" },
      { key: "SubjectDistance", label: "主体距离" },
    ],
  },
  {
    key: "time",
    title: "时间",
    description: "拍摄、创建与写入的时间戳",
    fields: [
      { key: "DateTimeOriginal", label: "拍摄时间" },
      { key: "CreateDate", label: "创建时间" },
      { key: "ModifyDate", label: "修改时间" },
      { key: "OffsetTimeOriginal", label: "拍摄时区" },
      { key: "OffsetTime", label: "时区" },
      { key: "SubSecTimeOriginal", label: "拍摄秒以下" },
      { key: "GPSDateTime", label: "GPS 时间" },
    ],
  },
  {
    key: "image",
    title: "图像",
    description: "像素、色彩与分辨率",
    fields: [
      { key: "Orientation", label: "方向" },
      { key: "ColorSpace", label: "色彩空间" },
      { key: "ExifImageWidth", label: "图像宽度" },
      { key: "ExifImageHeight", label: "图像高度" },
      { key: "XResolution", label: "水平分辨率" },
      { key: "YResolution", label: "垂直分辨率" },
      { key: "ResolutionUnit", label: "分辨率单位" },
      { key: "BitsPerSample", label: "位深" },
    ],
  },
  {
    key: "location",
    title: "位置",
    description: "拍摄点与朝向",
    fields: [
      { key: "latitude", label: "纬度" },
      { key: "longitude", label: "经度" },
      { key: "GPSLatitude", label: "GPS 纬度" },
      { key: "GPSLongitude", label: "GPS 经度" },
      { key: "GPSAltitude", label: "海拔" },
      { key: "GPSAltitudeRef", label: "海拔基准" },
      { key: "GPSImgDirection", label: "拍摄方向" },
      { key: "GPSImgDirectionRef", label: "方向基准" },
      { key: "GPSHPositioningError", label: "定位误差" },
      { key: "GPSProcessingMethod", label: "定位方式" },
    ],
  },
];

/** How many fields the schema/spec defines; the UI can never show more. */
export const EXIF_TOTAL_FIELD_COUNT = EXIF_FIELD_GROUPS.reduce(
  (total, group) => total + group.fields.length,
  0,
);

const ORIENTATION_LABELS: Record<number, string> = {
  1: "正常",
  2: "水平镜像",
  3: "旋转 180°",
  4: "垂直镜像",
  5: "转置",
  6: "顺时针 90°",
  7: "逆时针 90°",
  8: "逆时针 90° 镜像",
};

const COLOR_SPACE_LABELS: Record<string, string> = {
  srgb: "sRGB",
  "adobe rgb": "Adobe RGB",
  uncalibrated: "未校准",
};

const RESOLUTION_UNIT_LABELS: Record<string, string> = {
  inches: "英寸",
  inch: "英寸",
  cm: "厘米",
  centimeters: "厘米",
};

const ALTITUDE_REF_LABELS: Record<string, string> = {
  "above sea level": "海平面以上",
  "below sea level": "海平面以下",
  "above sea level (0)": "海平面以上",
  "below sea level (1)": "海平面以下",
  "0": "海平面以上",
  "1": "海平面以下",
};

const DIRECTION_REF_LABELS: Record<string, string> = {
  t: "真北",
  true: "真北",
  "true north": "真北",
  m: "磁北",
  magnetic: "磁北",
  "magnetic north": "磁北",
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  ExposureProgram: {
    manual: "手动",
    "normal program": "程序自动",
    "aperture priority": "光圈优先",
    "shutter priority": "快门优先",
    "creative program": "创意程序",
    "action program": "运动程序",
    "portrait mode": "人像模式",
    "landscape mode": "风景模式",
    bulb: "B 门",
    "not defined": "未定义",
  },
  ExposureMode: {
    "auto exposure": "自动曝光",
    "manual exposure": "手动曝光",
    "auto bracket": "自动包围",
  },
  WhiteBalance: {
    auto: "自动",
    manual: "手动",
  },
  MeteringMode: {
    average: "平均测光",
    "center weighted average": "中央重点平均测光",
    spot: "点测光",
    "multi spot": "多点测光",
    pattern: "评价测光",
    partial: "局部测光",
    other: "其他",
    unknown: "未知",
  },
  LightSource: {
    unknown: "未知",
    daylight: "日光",
    fluorescent: "荧光灯",
    "tungsten (incandescent light)": "钨丝灯",
    flash: "闪光灯",
    "fine weather": "晴天",
    "cloudy weather": "阴天",
    shade: "阴影",
    "standard light a": "标准光源 A",
    "standard light b": "标准光源 B",
    "standard light c": "标准光源 C",
    "d55": "D55",
    "d65": "D65",
    "d75": "D75",
  },
  SceneCaptureType: {
    standard: "标准",
    landscape: "风景",
    portrait: "人像",
    "night scene": "夜景",
  },
  Flash: {
    true: "已闪光",
    false: "未闪光",
  },
};

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dateTimeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? textValue(value) : CAPTURE_TIME_FORMATTER.format(parsed);
}

function enumValue(key: string, value: unknown): string | null {
  const text = textValue(value);
  if (text === null) return null;
  const dictionary = ENUM_LABELS[key];
  return dictionary?.[text.toLowerCase()] ?? text;
}

/**
 * Formats one tag for display.
 *
 * Returns `null` when the tag has no displayable value, which is the signal the
 * renderer uses to skip the whole row (`MediaExifDetail` never prints `—`).
 */
export function formatExifFieldValue(key: keyof MediaExif, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") {
    return ENUM_LABELS.Flash?.[String(value)] ?? (value ? "是" : "否");
  }

  switch (key) {
    case "FNumber":
      return formatAperture(numberValue(value));
    case "ExposureTime":
      return formatExposureTime(textValue(value));
    case "ISO": {
      const iso = numberValue(value);
      return iso === null ? null : `ISO ${iso}`;
    }
    case "FocalLength":
      return formatFocalLength(numberValue(value));
    case "FocalLengthIn35mmFormat": {
      const focal = formatFocalLength(numberValue(value));
      return focal ? `${focal}（等效）` : null;
    }
    case "ExposureCompensation": {
      const ev = numberValue(value);
      if (ev === null) return null;
      return `${ev > 0 ? "+" : ""}${decimal(ev, 2)} EV`;
    }
    case "DigitalZoomRatio": {
      const ratio = numberValue(value);
      return ratio === null ? null : `${decimal(ratio, 2)}×`;
    }
    case "SubjectDistance": {
      const distance = numberValue(value);
      return distance === null ? null : `${decimal(distance, 2)} 米`;
    }
    case "GPSAltitude": {
      const altitude = numberValue(value);
      return altitude === null ? null : `${decimal(altitude, 1)} 米`;
    }
    case "GPSImgDirection": {
      const direction = numberValue(value);
      return direction === null ? null : `${decimal(direction, 1)}°`;
    }
    case "GPSHPositioningError": {
      const error = numberValue(value);
      return error === null ? null : `${decimal(error, 1)} 米`;
    }
    case "GPSLatitude":
    case "GPSLongitude":
    case "latitude":
    case "longitude": {
      const coordinate = numberValue(value);
      return coordinate === null ? null : coordinate.toFixed(6);
    }
    case "Orientation": {
      const orientation = numberValue(value);
      return orientation === null ? null : (ORIENTATION_LABELS[orientation] ?? String(orientation));
    }
    case "ColorSpace": {
      const text = textValue(value);
      return text === null ? null : (COLOR_SPACE_LABELS[text.toLowerCase()] ?? text);
    }
    case "ResolutionUnit": {
      const text = textValue(value);
      return text === null ? null : (RESOLUTION_UNIT_LABELS[text.toLowerCase()] ?? text);
    }
    case "GPSAltitudeRef": {
      const text = textValue(value);
      return text === null ? null : (ALTITUDE_REF_LABELS[text.toLowerCase()] ?? text);
    }
    case "GPSImgDirectionRef": {
      const text = textValue(value);
      return text === null ? null : (DIRECTION_REF_LABELS[text.toLowerCase()] ?? text);
    }
    case "ExifImageWidth":
    case "ExifImageHeight": {
      const pixels = numberValue(value);
      return pixels === null ? null : `${pixels} px`;
    }
    case "XResolution":
    case "YResolution": {
      const dpi = numberValue(value);
      return dpi === null ? null : `${decimal(dpi, 0)} dpi`;
    }
    case "BitsPerSample": {
      const bits = numberValue(value);
      return bits === null ? null : `${bits} 位`;
    }
    case "DateTimeOriginal":
    case "CreateDate":
    case "ModifyDate":
    case "GPSDateTime":
      return dateTimeValue(value);
    case "ExposureProgram":
    case "ExposureMode":
    case "WhiteBalance":
    case "MeteringMode":
    case "LightSource":
    case "SceneCaptureType":
    case "Flash":
      return enumValue(key, value);
    default:
      return textValue(value) ?? (typeof value === "number" ? String(value) : null);
  }
}

export interface MediaExifRow {
  key: keyof MediaExif;
  label: string;
  value: string;
}

export interface MediaExifGroup {
  key: string;
  title: string;
  description: string;
  rows: MediaExifRow[];
}

/**
 * Groups the sparse `exif` object into the five display groups.
 *
 * Empty groups are dropped entirely; rows with no displayable value are skipped
 * one by one, so a photo that only carries `Make` renders one row, not fifty.
 */
export function groupExifFields(exif: MediaExif | null | undefined): MediaExifGroup[] {
  if (!exif) return [];
  const groups: MediaExifGroup[] = [];
  for (const group of EXIF_FIELD_GROUPS) {
    const rows: MediaExifRow[] = [];
    for (const field of group.fields) {
      const value = formatExifFieldValue(field.key, exif[field.key]);
      if (value === null) continue;
      rows.push({ key: field.key, label: field.label, value });
    }
    if (rows.length > 0) {
      groups.push({
        key: group.key,
        title: group.title,
        description: group.description,
        rows,
      });
    }
  }
  return groups;
}

/** How many of the 50 fields this photo actually carries. */
export function countExifFields(exif: MediaExif | null | undefined): number {
  return groupExifFields(exif).reduce((total, group) => total + group.rows.length, 0);
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
 * L2 — the photo detail surface.
 *
 * The short block (camera, exposure chips, capture time) stays as the research
 * report designed it. Under it sits the full metadata: the five schema groups,
 * collapsed by default, expandable to every field that has a value. This is the
 * gap the old 8-field panel left — `GPSAltitude`, `Artist`, `Software`,
 * `Orientation`, … now have a place to be read.
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
  const groups = groupExifFields(exif);
  const fieldCount = groups.reduce((total, group) => total + group.rows.length, 0);
  const [expanded, setExpanded] = useState(false);

  if (
    !camera &&
    !lens &&
    chips.length === 0 &&
    !captureTime &&
    !fallbackDate &&
    fieldCount === 0
  ) {
    return null;
  }

  return (
    <div
      className={cx("flex flex-col gap-3", className)}
      data-testid="media-exif-detail"
      data-exif-field-count={fieldCount}
    >
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

      {fieldCount > 0 ? (
        <div className="rounded-control border border-hairline">
          <button
            type="button"
            data-testid="media-exif-toggle"
            aria-expanded={expanded}
            aria-controls="media-exif-fields"
            onClick={() => setExpanded((current) => !current)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[11px] text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
          >
            <span>
              {expanded
                ? `收起拍摄参数（${fieldCount} / ${EXIF_TOTAL_FIELD_COUNT} 项）`
                : `展开全部拍摄参数（${fieldCount} / ${EXIF_TOTAL_FIELD_COUNT} 项）`}
            </span>
            <span aria-hidden="true" className="font-mono text-[10px] text-stone">
              {expanded ? "−" : "+"}
            </span>
          </button>

          {expanded ? (
            <div
              id="media-exif-fields"
              data-testid="media-exif-fields"
              className="space-y-3 border-t border-hairline px-3 py-3"
            >
              {groups.map((group) => (
                <section key={group.key} data-exif-group={group.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink">
                      {group.title}
                    </h4>
                    <span className="font-mono text-[8px] text-stone">
                      {group.rows.length} 项 · {group.description}
                    </span>
                  </div>
                  <dl className="mt-1.5 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    {group.rows.map((row) => (
                      <div
                        key={row.key}
                        data-exif-field={row.key}
                        className="flex items-baseline justify-between gap-3 border-b border-hairline py-1 last:border-b-0"
                      >
                        <dt className="shrink-0 text-[10px] text-stone">{row.label}</dt>
                        <dd className="min-w-0 break-words text-right font-mono text-[10px] text-white/80">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}