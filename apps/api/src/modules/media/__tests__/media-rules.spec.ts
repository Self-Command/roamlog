import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  assertSafeMediaKey,
  assertSupportedImage,
  buildMediaKey,
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
