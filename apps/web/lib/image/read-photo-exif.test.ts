import { describe, expect, it, vi } from "vitest";

import { PHOTO_EXIF_MAX_BYTES, readPhotoExif, type PhotoExifParser } from "./read-photo-exif";

function makeFile(size = 1024, name = "IMG_0001.HEIC"): File {
  const file = new File(["exif-bytes"], name, { type: "image/heic" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** A realistic exifr output: revived `Date`s, dictionary labels, DMS arrays. */
const IPHONE_EXIF: Record<string, unknown> = {
  Make: "Apple",
  Model: "iPhone 15 Pro",
  LensModel: "iPhone 15 Pro back triple camera 6.765mm f/1.78",
  Software: "17.4.1",
  FNumber: 1.78,
  ExposureTime: 0.004,
  ISO: 200,
  FocalLength: 6.765,
  FocalLengthIn35mmFormat: 24,
  ExposureCompensation: 0.33,
  Flash: "Flash did not fire",
  WhiteBalance: "Auto",
  MeteringMode: "Pattern",
  DateTimeOriginal: new Date("2026-11-02T03:04:05.000Z"),
  OffsetTimeOriginal: "+08:00",
  Orientation: 1,
  ColorSpace: "sRGB",
  ExifImageWidth: 4032,
  ExifImageHeight: 3024,
  latitude: 31.2304,
  longitude: 121.4737,
  GPSAltitude: 12.5,
  GPSLatitude: [31, 13, 49.44],
  GPSLongitude: [121, 28, 25.32],
};

function parserReturning(value: unknown): PhotoExifParser {
  return vi.fn(async () => value);
}

describe("readPhotoExif", () => {
  it("normalizes the curated fields and lifts the WGS-84 pair", async () => {
    const result = await readPhotoExif(makeFile(), { parse: parserReturning(IPHONE_EXIF) });
    expect(result).not.toBeNull();
    expect(result?.lat).toBeCloseTo(31.2304, 4);
    expect(result?.lng).toBeCloseTo(121.4737, 4);
    expect(result?.exif.Make).toBe("Apple");
    expect(result?.exif.Model).toBe("iPhone 15 Pro");
    // Numeric tags keep their numeric value, not a display string.
    expect(result?.exif.FNumber).toBe(1.78);
    expect(result?.exif.FocalLengthIn35mmFormat).toBe(24);
    expect(result?.exif.ISO).toBe(200);
    // Shutter speed collapses to the conventional fraction text.
    expect(result?.exif.ExposureTime).toBe("1/250");
    // `Flash` is a boolean in the stored snapshot (research §4.3).
    expect(result?.exif.Flash).toBe(false);
    // exifr's revived `Date` becomes ISO 8601, never a Date instance.
    expect(result?.exif.DateTimeOriginal).toBe("2026-11-02T03:04:05.000Z");
    expect(result?.exif.OffsetTimeOriginal).toBe("+08:00");
    // DMS arrays are converted to decimal degrees.
    expect(result?.exif.GPSLatitude).toBeCloseTo(31.2304, 3);
  });

  it("always emits the full curated key set, with null for what the file lacks", async () => {
    const result = await readPhotoExif(makeFile(), { parse: parserReturning({ Make: "Sony" }) });
    expect(result?.exif.Make).toBe("Sony");
    // Absent tags are `null`, never `undefined`: "missing" and "unknown" must not
    // blur, because the API re-validates this object on the way out.
    expect(result?.exif.Model).toBeNull();
    expect(result?.exif.FNumber).toBeNull();
    expect(result?.exif.GPSAltitude).toBeNull();
    expect(Object.values(result?.exif ?? {}).every((value) => value !== undefined)).toBe(true);
  });

  it("drops only the out-of-range field instead of the whole snapshot", async () => {
    const result = await readPhotoExif(makeFile(), {
      parse: parserReturning({ ...IPHONE_EXIF, FNumber: 0, Orientation: 42 }),
    });
    expect(result?.exif.FNumber).toBeNull();
    expect(result?.exif.Orientation).toBeNull();
    // Everything else survives — the reason validation is per field.
    expect(result?.exif.ISO).toBe(200);
    expect(result?.lat).toBeCloseTo(31.2304, 4);
  });

  it("treats a (0, 0) fix as 'no position' rather than the Gulf of Guinea", async () => {
    const result = await readPhotoExif(makeFile(), {
      parse: parserReturning({ ...IPHONE_EXIF, latitude: 0, longitude: 0, GPSLatitude: 0 }),
    });
    expect(result?.lat).toBeNull();
    expect(result?.lng).toBeNull();
  });

  it("returns null (never throws) for a file the parser cannot read", async () => {
    const failing: PhotoExifParser = vi.fn(async () => {
      throw new Error("corrupt file");
    });
    await expect(readPhotoExif(makeFile(), { parse: failing })).resolves.toBeNull();
  });

  it("returns null for an empty parser result and for a non-object result", async () => {
    await expect(readPhotoExif(makeFile(), { parse: parserReturning(null) })).resolves.toBeNull();
    await expect(
      readPhotoExif(makeFile(), { parse: parserReturning([1, 2, 3]) }),
    ).resolves.toBeNull();
  });

  it("skips oversized files without calling the parser", async () => {
    const parse = parserReturning(IPHONE_EXIF);
    const result = await readPhotoExif(makeFile(PHOTO_EXIF_MAX_BYTES + 1), { parse });
    expect(result).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it("gives up at the deadline without failing the upload", async () => {
    const hanging: PhotoExifParser = () => new Promise(() => {});
    await expect(readPhotoExif(makeFile(), { parse: hanging, timeoutMs: 5 })).resolves.toBeNull();
  });

  it("strips unknown keys and control characters from text tags", async () => {
    const result = await readPhotoExif(makeFile(), {
      parse: parserReturning({ Make: "  Canon\u0000  ", Evil: "drop-me" }),
    });
    expect(result?.exif.Make).toBe("Canon");
    expect(result?.exif).not.toHaveProperty("Evil");
  });
});
