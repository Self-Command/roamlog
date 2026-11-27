import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  MAX_MEDIA_BYTES,
  MAX_MOTION_BYTES,
  assertSafeMediaKey,
  assertSupportedImage,
  assertSupportedMotion,
  buildMediaKey,
  formatMegabytes,
  normalizeOriginalFileName,
  sanitizeFileName,
} from "../media-rules.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { MediaService } from "../media.service.js";

describe("media upload rules", () => {
  it("rejects unsupported MIME types and oversize uploads", () => {
    expect(() => assertSupportedImage("image/gif", 100)).toThrow(BadRequestException);
    expect(() => assertSupportedImage("image/jpeg", 25 * 1024 * 1024 + 1)).toThrow(
      BadRequestException,
    );
    expect(assertSupportedImage("IMAGE/WEBP", 1024)).toBe("image/webp");
  });

  it("never uses user path segments in generated keys", () => {
    const fileName = sanitizeFileName("../../etc/passwd");
    expect(fileName).not.toContain("..");
    const key = buildMediaKey({
      workspaceId: "01942f30-1200-7000-8000-000000000010",
      mediaId: "01942f30-1200-7000-8000-000000000020",
      mimeType: "image/jpeg",
      variant: "original",
      capturedAt: new Date("2026-11-17T00:00:00.000Z"),
    });
    expect(key).toBe(
      "01942f30-1200-7000-8000-000000000010/2026/11/01942f30-1200-7000-8000-000000000020/original.jpg",
    );
  });

  it("keeps a safe Unicode display name without coupling it to the object key", () => {
    expect(normalizeOriginalFileName("..\\旅行 京都\u0000.jpg")).toBe("旅行 京都.jpg");
    expect(normalizeOriginalFileName('family<photo>:"summer"?.jpg')).toBe("familyphotosummer.jpg");
    expect(normalizeOriginalFileName("  .hidden.photo.jpg  ")).toBe("hidden.photo.jpg");
    expect(normalizeOriginalFileName("x".repeat(400))).toHaveLength(255);
  });

  it("rejects traversal or absolute object keys", () => {
    expect(() => assertSafeMediaKey("../secret/photo.jpg")).toThrow(BadRequestException);
    expect(() => assertSafeMediaKey("/absolute/photo.jpg")).toThrow(BadRequestException);
    expect(() => assertSafeMediaKey("workspace/2026/11//photo.jpg")).toThrow(BadRequestException);
  });

  it("rejects an unsupported MIME type at the presign service boundary", async () => {
    const service = new MediaService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new PermissionService(),
      {} as never,
    );
    await expect(
      service.presign(
        {
          user: { id: "01942f30-1200-7000-8000-000000000001" },
        } as never,
        {
          workspaceId: "01942f30-1200-7000-8000-000000000010",
          userId: "01942f30-1200-7000-8000-000000000001",
          role: "editor",
        } as never,
        { fileName: "photo.gif", mimeType: "image/gif", size: 10 },
      ),
    ).rejects.toThrow();
  });
});

/** The response object of a Nest BadRequestException, as the client sees it. */
function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    const response = (error as BadRequestException).getResponse();
    return typeof response === "string"
      ? response
      : ((response as { message?: string }).message ?? "");
  }
  throw new Error("Expected the call to throw BadRequestException");
}

describe("user-facing byte copy", () => {
  it("formats megabytes in decimal, like the web app's @/lib/format-bytes", () => {
    expect(formatMegabytes(MAX_MOTION_BYTES)).toBe("52.4 MB");
    expect(formatMegabytes(1_500_000)).toBe("1.5 MB");
    expect(formatMegabytes(25_000_000)).toBe("25 MB");
    // A trailing .0 is dropped, exactly like the web helper.
    expect(formatMegabytes(3_000_000)).toBe("3 MB");
  });

  it("derives the motion ceiling copy from MAX_MOTION_BYTES", () => {
    const message = errorMessage(() =>
      assertSupportedMotion({ mimeType: "video/quicktime", sizeBytes: MAX_MOTION_BYTES + 1 }),
    );

    // The expected string is computed from the constant, so changing the
    // constant without updating the copy fails here instead of shipping a
    // stale number: 50 MiB used to be announced as "50 MB".
    expect(message).toBe(
      `Live Photo motion clips must be between 1 byte and ${formatMegabytes(MAX_MOTION_BYTES)}.`,
    );
    expect(message).toContain("52.4 MB");
    expect(message).not.toContain("50 MB");
  });

  it("keeps the advertised 25 MB in the image copy, not the server's 26.2 MB slack", () => {
    const message = errorMessage(() => assertSupportedImage("image/jpeg", MAX_MEDIA_BYTES + 1));

    // MAX_MEDIA_BYTES is 26,214,400 (25 MiB) while settings advertise
    // 25,000,000. Deriving this copy from the constant would print 26.2 MB and
    // contradict the client, so it deliberately states the advertised limit.
    expect(formatMegabytes(MAX_MEDIA_BYTES)).toBe("26.2 MB");
    expect(MAX_MEDIA_BYTES).toBeGreaterThan(25_000_000);
    expect(message).toContain("25 MB");
    expect(message).not.toContain("26.2 MB");
  });
});
