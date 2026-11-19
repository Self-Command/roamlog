import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MediaExif } from "@roamlog/contracts";

import {
  MediaExifDetail,
  MediaExifSummary,
  formatCameraName,
  formatCaptureDate,
  formatExposureSummary,
} from "./media-exif";

/** Only the fields a case needs; the rest of the snapshot is legitimately null. */
function exif(overrides: Partial<MediaExif> = {}): MediaExif {
  return { ...overrides } as MediaExif;
}

const CAMERA_PHOTO = exif({
  Make: "Apple",
  Model: "iPhone 15 Pro",
  LensModel: "iPhone 15 Pro back triple camera 6.765mm f/1.78",
  FNumber: 1.8,
  ExposureTime: "1/250",
  ISO: 200,
  FocalLength: 24,
  DateTimeOriginal: "2026-11-02T03:04:05.000Z",
  latitude: 31.2304,
  longitude: 121.4737,
});

describe("EXIF formatting", () => {
  it("de-duplicates the maker instead of printing 'Apple Apple iPhone 15 Pro'", () => {
    expect(formatCameraName(exif({ Make: "Apple", Model: "iPhone 15 Pro" }))).toBe(
      "iPhone 15 Pro",
    );
    expect(formatCameraName(exif({ Make: "SONY", Model: "Sony A7 IV" }))).toBe("Sony A7 IV");
    expect(formatCameraName(exif({ Make: "Canon", Model: "EOS R6" }))).toBe("Canon EOS R6");
    expect(formatCameraName(exif({ Make: "Apple" }))).toBe("Apple");
    expect(formatCameraName(null)).toBeNull();
  });

  it("builds the single card exposure value as 'ƒ/1.8 · 24mm'", () => {
    expect(formatExposureSummary(exif({ FNumber: 1.8, FocalLength: 24 }))).toBe("ƒ/1.8 · 24mm");
    // A 35mm-equivalent stands in when the real focal length is absent.
    expect(formatExposureSummary(exif({ FNumber: 2, FocalLengthIn35mmFormat: 35 }))).toBe(
      "ƒ/2 · 35mm",
    );
    expect(formatExposureSummary(exif({ ISO: 100 }))).toBeNull();
  });

  it("prefers the row date and falls back to the EXIF capture date", () => {
    expect(formatCaptureDate("2026-11-02", CAMERA_PHOTO)).toBe("11月2日");
    expect(formatCaptureDate(null, CAMERA_PHOTO)).toBe("11月2日");
    expect(formatCaptureDate(null, exif())).toBeNull();
  });
});

describe("MediaExifSummary (L1 card line)", () => {
  it("shows date, camera and the exposure value, plus the position marker", () => {
    render(<MediaExifSummary exif={CAMERA_PHOTO} date="2026-11-02" />);
    expect(screen.getByText("11月2日")).toBeTruthy();
    expect(screen.getByText("iPhone 15 Pro")).toBeTruthy();
    expect(screen.getByText("ƒ/1.8 · 24mm")).toBeTruthy();
    expect(screen.getByText("有位置")).toBeTruthy();
  });

  it("keeps the exposure value for wide screens only (mobile = date + camera)", () => {
    render(<MediaExifSummary exif={CAMERA_PHOTO} date="2026-11-02" />);
    // The responsive class is the mechanism, so assert it rather than a layout.
    expect(screen.getByText("ƒ/1.8 · 24mm").className).toContain("hidden");
    expect(screen.getByText("ƒ/1.8 · 24mm").className).toContain("sm:inline");
    expect(screen.getByText("iPhone 15 Pro").className).not.toContain("hidden");
  });

  it("omits the position marker when the photo has no GPS", () => {
    render(<MediaExifSummary exif={exif({ Model: "Pixel 8" })} date="2026-11-02" />);
    expect(screen.queryByText("有位置")).toBeNull();
  });

  it("renders nothing at all for a photo with no readable metadata", () => {
    const { container } = render(<MediaExifSummary exif={null} date={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("never prints placeholder values for missing tags", () => {
    render(<MediaExifSummary exif={exif({ Model: "Pixel 8" })} date="2026-11-02" />);
    expect(screen.queryByText(/Unknown|null|undefined|----/)).toBeNull();
  });
});

describe("MediaExifDetail (L2 detail)", () => {
  it("groups the camera/lens block, the exposure chips and the capture time", () => {
    render(<MediaExifDetail exif={CAMERA_PHOTO} date="2026-11-02" />);
    expect(screen.getByText("iPhone 15 Pro")).toBeTruthy();
    expect(
      screen.getByText("iPhone 15 Pro back triple camera 6.765mm f/1.78"),
    ).toBeTruthy();
    expect(screen.getByText("ISO 200")).toBeTruthy();
    expect(screen.getByText("24mm")).toBeTruthy();
    expect(screen.getByText("ƒ/1.8")).toBeTruthy();
    expect(screen.getByText("1/250 s")).toBeTruthy();
    expect(screen.getByText("拍摄时间")).toBeTruthy();
  });

  it("renders nothing when there is no metadata to show", () => {
    const { container } = render(<MediaExifDetail exif={null} date={null} />);
    expect(container.firstChild).toBeNull();
  });
});
