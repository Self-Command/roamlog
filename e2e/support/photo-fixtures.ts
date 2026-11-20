/**
 * Synthetic PNG fixtures with a real EXIF block for the photo journey.
 *
 * The acceptance requirement is "3 张带 GPS 的 PNG", so the files have to be
 * real PNGs whose `eXIf` chunk contains a real little-endian TIFF/EXIF payload —
 * not a JPEG renamed to `.png`. `exifr` (the browser reader) dispatches on the
 * PNG signature and injects the `eXIf` chunk into its TIFF parser
 * (`exifr/src/file-parsers/png.mjs`), so this is the shape the uploader sees in
 * production too.
 *
 * Everything here is test-support code: no product module imports it.
 */
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;

type ExifValue = number[] | string;

interface ExifEntry {
  tag: number;
  type: number;
  value: ExifValue;
}

function entryPayload(entry: ExifEntry): Buffer {
  if (entry.type === TYPE_ASCII) {
    return Buffer.from(`${String(entry.value)}\0`, "latin1");
  }
  if (entry.type === TYPE_BYTE) {
    return Buffer.from(entry.value as number[]);
  }
  if (entry.type === TYPE_SHORT) {
    const values = entry.value as number[];
    const buffer = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
    return buffer;
  }
  if (entry.type === TYPE_LONG) {
    const values = entry.value as number[];
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
    return buffer;
  }
  if (entry.type === TYPE_RATIONAL || entry.type === TYPE_SRATIONAL) {
    const pairs = entry.value as number[];
    const buffer = Buffer.alloc((pairs.length / 2) * 8);
    for (let index = 0; index < pairs.length; index += 2) {
      const numerator = pairs[index] ?? 0;
      const denominator = pairs[index + 1] ?? 1;
      const offset = (index / 2) * 8;
      if (entry.type === TYPE_SRATIONAL) buffer.writeInt32LE(numerator, offset);
      else buffer.writeUInt32LE(numerator, offset);
      buffer.writeUInt32LE(denominator, offset + 4);
    }
    return buffer;
  }
  throw new Error(`Unsupported EXIF type ${entry.type}`);
}

function entryCount(entry: ExifEntry): number {
  if (entry.type === TYPE_ASCII) return Buffer.byteLength(`${String(entry.value)}\0`, "latin1");
  const values = entry.value as number[];
  // RATIONAL/SRATIONAL payloads are stored as flattened (numerator, denominator)
  // pairs, while the TIFF `count` field counts the pairs.
  return entry.type === TYPE_RATIONAL || entry.type === TYPE_SRATIONAL
    ? values.length / 2
    : values.length;
}

function ifdSize(entryCountValue: number): number {
  return 2 + entryCountValue * 12 + 4;
}

function writeIfd(entries: ExifEntry[], dataOffset: number, data: Buffer[]): Buffer {
  const sorted = [...entries].sort((left, right) => left.tag - right.tag);
  const ifd = Buffer.alloc(ifdSize(sorted.length));
  ifd.writeUInt16LE(sorted.length, 0);
  let cursor = 2;
  for (const entry of sorted) {
    const payload = entryPayload(entry);
    ifd.writeUInt16LE(entry.tag, cursor);
    ifd.writeUInt16LE(entry.type, cursor + 2);
    ifd.writeUInt32LE(entryCount(entry), cursor + 4);
    if (payload.length <= 4) {
      payload.copy(ifd, cursor + 8);
    } else {
      // The data area starts after every IFD; append and remember its offset.
      const already = data.reduce((total, chunk) => total + chunk.length, 0);
      const aligned = already % 2 === 0 ? already : already + 1;
      if (aligned > already) data.push(Buffer.alloc(1));
      ifd.writeUInt32LE(dataOffset + aligned, cursor + 8);
      data.push(payload);
    }
    cursor += 12;
  }
  ifd.writeUInt32LE(0, cursor); // no next IFD
  return ifd;
}

function dms(value: number): number[] {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  let seconds = Math.round((minutesFloat - minutes) * 60 * 10_000);
  if (seconds >= 600_000) seconds = 599_999;
  return [degrees, 1, minutes, 1, seconds, 10_000];
}

export interface GpsPngOptions {
  name: string;
  width?: number;
  height?: number;
  lat: number;
  lng: number;
  altitude?: number;
  direction?: number;
  /** Local wall-clock used for DateTimeOriginal / CreateDate / ModifyDate. */
  shotAt?: string;
  make?: string;
  model?: string;
  /** Base hue used for the synthetic landscape, 0–360. */
  hue?: number;
}

function buildExif(options: GpsPngOptions): Buffer {
  const shotAt = options.shotAt ?? "2026:11:20 18:30:00";
  const altitude = Math.round((options.altitude ?? 45.6) * 10);
  const direction = Math.round((options.direction ?? 135) * 1);

  const exifEntries: ExifEntry[] = [
    { tag: 0x829a, type: TYPE_RATIONAL, value: [1, 250] }, // ExposureTime 1/250 s
    { tag: 0x829d, type: TYPE_RATIONAL, value: [18, 10] }, // FNumber 1.8
    { tag: 0x8822, type: TYPE_SHORT, value: [2] }, // ExposureProgram normal
    { tag: 0x8827, type: TYPE_SHORT, value: [200] }, // ISO
    { tag: 0x920a, type: TYPE_RATIONAL, value: [240, 10] }, // FocalLength 24
    { tag: 0x9202, type: TYPE_RATIONAL, value: [25, 10] }, // SubjectDistance 2.5
    { tag: 0x9204, type: TYPE_SRATIONAL, value: [3, 10] }, // ExposureCompensation +0.3
    { tag: 0x9207, type: TYPE_SHORT, value: [5] }, // MeteringMode pattern
    { tag: 0x9208, type: TYPE_SHORT, value: [1] }, // LightSource daylight
    { tag: 0x9209, type: TYPE_SHORT, value: [1] }, // Flash fired
    { tag: 0x9003, type: TYPE_ASCII, value: shotAt }, // DateTimeOriginal
    { tag: 0x9004, type: TYPE_ASCII, value: shotAt }, // CreateDate
    { tag: 0x9010, type: TYPE_ASCII, value: "+08:00" }, // OffsetTime
    { tag: 0x9011, type: TYPE_ASCII, value: "+08:00" }, // OffsetTimeOriginal
    { tag: 0x9291, type: TYPE_ASCII, value: "123" }, // SubSecTimeOriginal
    { tag: 0xa402, type: TYPE_SHORT, value: [0] }, // ExposureMode auto
    { tag: 0xa403, type: TYPE_SHORT, value: [0] }, // WhiteBalance auto
    { tag: 0xa404, type: TYPE_RATIONAL, value: [15, 10] }, // DigitalZoomRatio 1.5
    { tag: 0xa405, type: TYPE_SHORT, value: [26] }, // FocalLengthIn35mmFormat
    { tag: 0xa406, type: TYPE_SHORT, value: [1] }, // SceneCaptureType landscape
    { tag: 0xa001, type: TYPE_SHORT, value: [1] }, // ColorSpace sRGB
    { tag: 0xa002, type: TYPE_LONG, value: [options.width ?? 800] }, // ExifImageWidth
    { tag: 0xa003, type: TYPE_LONG, value: [options.height ?? 600] }, // ExifImageHeight
    { tag: 0xa430, type: TYPE_ASCII, value: "Verify Owner" }, // OwnerName
    { tag: 0xa431, type: TYPE_ASCII, value: "SN-RL-0001" }, // BodySerialNumber
    { tag: 0xa433, type: TYPE_ASCII, value: "Roamlog Optics" }, // LensMake
    { tag: 0xa434, type: TYPE_ASCII, value: "RL 24mm f/1.8" }, // LensModel
    { tag: 0xa435, type: TYPE_ASCII, value: "LN-0001" }, // LensSerialNumber
  ];

  const gpsEntries: ExifEntry[] = [
    { tag: 0x0000, type: TYPE_BYTE, value: [2, 3, 0, 0] }, // GPSVersionID
    { tag: 0x0001, type: TYPE_ASCII, value: options.lat >= 0 ? "N" : "S" },
    { tag: 0x0002, type: TYPE_RATIONAL, value: dms(options.lat) },
    { tag: 0x0003, type: TYPE_ASCII, value: options.lng >= 0 ? "E" : "W" },
    { tag: 0x0004, type: TYPE_RATIONAL, value: dms(options.lng) },
    { tag: 0x0005, type: TYPE_BYTE, value: [options.altitude !== undefined && options.altitude < 0 ? 1 : 0] },
    { tag: 0x0006, type: TYPE_RATIONAL, value: [altitude, 10] },
    { tag: 0x0007, type: TYPE_RATIONAL, value: [10, 1, 30, 1, 0, 1] }, // GPSTimeStamp
    { tag: 0x0010, type: TYPE_ASCII, value: "T" }, // GPSImgDirectionRef
    { tag: 0x0011, type: TYPE_RATIONAL, value: [direction, 1] }, // GPSImgDirection
    { tag: 0x001f, type: TYPE_RATIONAL, value: [42, 10] }, // GPSHPositioningError 4.2 m
  ];

  const ifd0Entries: ExifEntry[] = [
    { tag: 0x0100, type: TYPE_LONG, value: [options.width ?? 800] }, // ImageWidth
    { tag: 0x0101, type: TYPE_LONG, value: [options.height ?? 600] }, // ImageLength
    { tag: 0x0102, type: TYPE_SHORT, value: [8] }, // BitsPerSample
    { tag: 0x010f, type: TYPE_ASCII, value: options.make ?? "Roamlog Camera" }, // Make
    { tag: 0x0110, type: TYPE_ASCII, value: options.model ?? "RL-X1" }, // Model
    { tag: 0x0112, type: TYPE_SHORT, value: [1] }, // Orientation normal
    { tag: 0x011a, type: TYPE_RATIONAL, value: [300, 1] }, // XResolution
    { tag: 0x011b, type: TYPE_RATIONAL, value: [300, 1] }, // YResolution
    { tag: 0x0128, type: TYPE_SHORT, value: [2] }, // ResolutionUnit inches
    { tag: 0x0131, type: TYPE_ASCII, value: "Roamlog Verify 1.0" }, // Software
    { tag: 0x0132, type: TYPE_ASCII, value: shotAt.replace(/\//g, ":") }, // ModifyDate
    { tag: 0x013b, type: TYPE_ASCII, value: "Roamlog Verify" }, // Artist
    { tag: 0x8298, type: TYPE_ASCII, value: "Roamlog E2E" }, // Copyright
  ];

  // Sizes are fixed before the offsets can be computed; the pointer entries are
  // appended with placeholder values and overwritten once both offsets exist.
  const size0 = ifdSize(ifd0Entries.length + 2);
  const sizeExif = ifdSize(exifEntries.length);
  const sizeGps = ifdSize(gpsEntries.length);
  const exifOffset = 8 + size0;
  const gpsOffset = exifOffset + sizeExif;
  const dataOffset = gpsOffset + sizeGps;

  ifd0Entries.push(
    { tag: 0x8769, type: TYPE_LONG, value: [exifOffset] }, // ExifIFDPointer
    { tag: 0x8825, type: TYPE_LONG, value: [gpsOffset] }, // GPSInfoIFDPointer
    // These two have to appear *after* the pointer entries in tag order, which
    // `writeIfd` sorts anyway.
  );

  const data: Buffer[] = [];
  const header = Buffer.alloc(8);
  header.write("II", 0, "latin1");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);

  const ifd0 = writeIfd(ifd0Entries, dataOffset, data);
  const exif = writeIfd(exifEntries, dataOffset, data);
  const gps = writeIfd(gpsEntries, dataOffset, data);

  return Buffer.concat([header, ifd0, exif, gps, ...data]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function gradientPixels(width: number, height: number, hue: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const skyTop = { r: 22, g: 34, b: 58 };
  const skyBottom = { r: 210, g: 120 + (hue % 90), b: 70 };
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const t = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const sunDistance = Math.hypot(x - width * 0.72, y - height * 0.32);
      const sun = Math.max(0, 1 - sunDistance / (width * 0.12));
      const ridge =
        Math.sin((x / width) * Math.PI * 3 + hue) * height * 0.06 + height * 0.68;
      const ground = y > ridge ? 1 : 0;
      const base = ground
        ? { r: 18, g: 24, b: 22 }
        : {
            r: Math.round(skyTop.r + (skyBottom.r - skyTop.r) * t),
            g: Math.round(skyTop.g + (skyBottom.g - skyTop.g) * t),
            b: Math.round(skyTop.b + (skyBottom.b - skyTop.b) * t),
          };
      raw[offset] = Math.min(255, Math.round(base.r + sun * 150));
      raw[offset + 1] = Math.min(255, Math.round(base.g + sun * 130));
      raw[offset + 2] = Math.min(255, Math.round(base.b + sun * 80));
    }
  }
  return raw;
}

/** A real PNG buffer whose `eXIf` chunk carries the EXIF/GPS payload above. */
export function gpsPng(options: GpsPngOptions): { name: string; mimeType: string; buffer: Buffer } {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const exif = buildExif({ ...options, width, height });
  const idat = deflateSync(gradientPixels(width, height, options.hue ?? 30), { level: 9 });
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("eXIf", exif),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { name: options.name, mimeType: "image/png", buffer: png };
}

/** The three acceptance photos: Kyoto, Osaka, Nara. */
export function acceptancePhotos() {
  return [
    gpsPng({
      name: "verify-kyoto-gps.png",
      lat: 35.0116,
      lng: 135.7681,
      altitude: 52.4,
      direction: 135,
      hue: 30,
      shotAt: "2026:11:20 18:30:00",
    }),
    gpsPng({
      name: "verify-osaka-gps.png",
      width: 720,
      height: 540,
      lat: 34.6937,
      lng: 135.5023,
      altitude: 18.2,
      direction: 245,
      hue: 210,
      shotAt: "2026:11:19 20:05:00",
    }),
    gpsPng({
      name: "verify-nara-gps.png",
      width: 640,
      height: 480,
      lat: 34.6851,
      lng: 135.8048,
      altitude: 96.8,
      direction: 20,
      hue: 120,
      shotAt: "2026:11:18 09:12:00",
    }),
  ];
}

/** 21 distinct photos for the over-limit assertion (tiny, never uploaded). */
export function batchOf(count: number) {
  return Array.from({ length: count }, (_, index) =>
    gpsPng({
      name: `verify-batch-${String(index + 1).padStart(2, "0")}.png`,
      width: 64 + index,
      height: 48 + index,
      lat: 35.01 + index * 0.001,
      lng: 135.76 + index * 0.001,
      hue: index * 17,
    }),
  );
}