import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats byte counts with decimal units", () => {
    expect(formatBytes(25_000_000)).toBe("25 MB");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(100_000_000)).toBe("100 MB");
    // Same rounding as the web client, which keeps one decimal above 10 MB too.
    expect(formatBytes(12_345_678)).toBe("12.3 MB");
  });

  it("never applies the binary 1,024 divisor", () => {
    // Binary rendering would show these as 1.5 MB and 25 MB; the web client and
    // the media.maxUploadBytes setting use the decimal values instead.
    expect(formatBytes(1_572_864)).toBe("1.6 MB");
    expect(formatBytes(26_214_400)).toBe("26.2 MB");
  });

  it("keeps the zh-CN thousands separator and integral kilobytes", () => {
    expect(formatBytes(999_999)).toBe("1,000 KB");
    expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
    expect(formatBytes(3_000_000_000_000)).toBe("3 TB");
  });

  it("drops a trailing .0 and keeps small units exact", () => {
    expect(formatBytes(1_048_576)).toBe("1 MB");
    expect(formatBytes(10_000_000)).toBe("10 MB");
    expect(formatBytes(1_000)).toBe("1 KB");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(0)).toBe("0 B");
  });
});