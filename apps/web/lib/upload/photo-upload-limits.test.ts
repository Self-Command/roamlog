import { describe, expect, it } from "vitest";

import { parseMediaUploadLimits, type MediaUploadLimits } from "@/lib/api/media";

import {
  PHOTO_UPLOAD_GENERIC_HINT,
  overBatchLimitMessage,
  presignRateLimitMessage,
  restrictionMessage,
  uploadLimitHint,
} from "./photo-upload-limits";

const LIMITS: MediaUploadLimits = {
  maxFilesPerBatch: 20,
  maxFileBytes: 26_214_400,
  maxBatchBytes: 157_286_400,
  presignPerMinute: 20,
};

const RAISED: MediaUploadLimits = {
  maxFilesPerBatch: 35,
  maxFileBytes: 52_428_800,
  maxBatchBytes: 314_572_800,
  presignPerMinute: 45,
};

describe("upload limit copy (server-owned values)", () => {
  it("without limits: no number appears at all", () => {
    expect(uploadLimitHint(null)).toBe(PHOTO_UPLOAD_GENERIC_HINT);
    expect(uploadLimitHint(null)).not.toMatch(/\d/u);
  });

  it("renders the server's numbers, not the legacy constants", () => {
    const hint = uploadLimitHint(LIMITS);
    expect(hint).toContain("20 张");
    expect(hint).toContain("26.2 MB");
    expect(hint).toContain("157.3 MB");
    expect(hint).toContain("每分钟最多上传 20 次");

    // A different configuration changes every number in the sentence.
    const raised = uploadLimitHint(RAISED);
    expect(raised).toContain("35 张");
    expect(raised).toContain("52.4 MB");
    expect(raised).toContain("314.6 MB");
    expect(raised).toContain("每分钟最多上传 45 次");
    expect(raised).not.toContain("20 张");
  });

  it("names the rejected file and the server's batch value", () => {
    const message = overBatchLimitMessage("photo.png", LIMITS);
    expect(message).toContain("「photo.png」以及后续照片");
    expect(message).toContain("一次最多上传 20 张");
    expect(message).toContain("每分钟最多上传 20 次");
    expect(overBatchLimitMessage(undefined, RAISED)).toContain("一次最多上传 35 张");
  });

  it("appends the server's ceilings to a restriction failure", () => {
    const withLimits = restrictionMessage("文件太大", LIMITS);
    expect(withLimits).toContain("单张 26.2 MB");
    expect(withLimits).toContain("单批合计 157.3 MB");
    expect(restrictionMessage("文件太大", null)).toContain("上传时会按当前账号的上限校验");
    expect(restrictionMessage("文件太大", null)).not.toMatch(/\d+\.?\d*\s*MB/u);
  });

  it("uses the server's presign quota in the 429 copy", () => {
    expect(presignRateLimitMessage(20)).toContain("每分钟最多上传 20 次");
    expect(presignRateLimitMessage(45)).toContain("每分钟最多上传 45 次");
    const unknown = presignRateLimitMessage(undefined);
    expect(unknown).not.toMatch(/\d/u);
  });

  it("describes limits without exposing implementation terms", () => {
    const copy = [
      uploadLimitHint(LIMITS),
      uploadLimitHint(null),
      overBatchLimitMessage("photo.png", LIMITS),
      restrictionMessage("文件太大", LIMITS),
      restrictionMessage("文件太大", null),
      presignRateLimitMessage(20),
      presignRateLimitMessage(undefined),
    ];

    for (const message of copy) {
      expect(message).not.toMatch(/服务端|签发|上传链接|HTTP/u);
    }
  });
});

describe("parseMediaUploadLimits", () => {
  it("accepts the exact four positive fields", () => {
    expect(parseMediaUploadLimits(LIMITS)).toEqual(LIMITS);
  });

  it("rejects partial, non-numeric or non-positive payloads", () => {
    expect(parseMediaUploadLimits(null)).toBeNull();
    expect(parseMediaUploadLimits({})).toBeNull();
    expect(parseMediaUploadLimits({ ...LIMITS, presignPerMinute: undefined })).toBeNull();
    expect(parseMediaUploadLimits({ ...LIMITS, maxFileBytes: "25" })).toBeNull();
    expect(parseMediaUploadLimits({ ...LIMITS, maxFilesPerBatch: 0 })).toBeNull();
    expect(parseMediaUploadLimits({ ...LIMITS, maxBatchBytes: Number.NaN })).toBeNull();
  });
});
