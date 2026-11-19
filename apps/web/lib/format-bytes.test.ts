import { describe, expect, it } from "vitest";

import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("formats the compression target as decimal 1.5 MB, never binary 1.4 MB", () => {
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(1_500_000)).not.toBe("1.4 MB");
  });

  it("formats the 50 MiB live-photo ceiling as decimal 52.4 MB", () => {
    expect(formatBytes(52_428_800)).toBe("52.4 MB");
    expect(formatBytes(52_428_800)).not.toBe("50 MB");
  });

  it("keeps the rules the cover upload UI already established", () => {
    expect(formatBytes(25_000_000)).toBe("25 MB");
    expect(formatBytes(1_572_864)).toBe("1.6 MB");
    expect(formatBytes(1_024)).toBe("1 KB");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("drops a trailing .0 so whole megabytes stay short", () => {
    expect(formatBytes(3_000_000)).toBe("3 MB");
    expect(formatBytes(3_500_000)).toBe("3.5 MB");
  });
});