import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { MediaUrlService, type MediaUrlSource } from "../media-url.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { SignedReadUrl, StorageService } from "../../storage/storage.service.js";

const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const OTHER_MEDIA_ID = "01942f30-1200-7000-8000-000000000011";
const DEFAULT_EXPIRY = "2026-11-18T12:00:00.000Z";
const BUCKET_A = "roamlog-bucket-a";
const BUCKET_B = "roamlog-bucket-b";

function storageStub(expiresAt: (key: string) => string = () => DEFAULT_EXPIRY) {
  const calls: Array<{ key: string; bucket: string | undefined }> = [];
  const storage = {
    createSignedReadUrl: async (
      key: string,
      _expiresInSeconds?: number,
      bucket?: string,
    ): Promise<SignedReadUrl> => {
      calls.push({ key, bucket });
      return {
        // The bucket in the path mirrors path-style S3, which is how the real
        // signer exposes which bucket a URL belongs to.
        url: `https://cdn.example.test/${bucket ?? "current-bucket"}/${key}?X-Amz-Signature=stub`,
        key,
        expiresAt: expiresAt(key),
      };
    },
  };
  return { storage: storage as unknown as StorageService, calls };
}

function readyMedia(overrides: Partial<MediaUrlSource> = {}): MediaUrlSource {
  return {
    id: MEDIA_ID,
    key: "ws/2026/11/media/original.jpg",
    bucket: BUCKET_A,
    status: "ready",
    variants: {
      original: { key: "ws/2026/11/media/original.jpg" },
      large: { key: "ws/2026/11/media/large.webp" },
      thumb: { key: "ws/2026/11/media/thumb.webp" },
    },
    ...overrides,
  };
}

describe("MediaUrlService", () => {
  it("prefers the large variant for url and the thumb variant for thumbUrl", async () => {
    const { storage, calls } = storageStub();
    const urls = await new MediaUrlService(storage).sign(readyMedia());

    expect(urls.url).toContain("large.webp");
    expect(urls.thumbUrl).toContain("thumb.webp");
    expect(urls.expiresAt).toBe(DEFAULT_EXPIRY);
    expect(calls.map((call) => call.key).sort()).toEqual([
      "ws/2026/11/media/large.webp",
      "ws/2026/11/media/thumb.webp",
    ]);
  });

  it("returns no storage coordinates or variant map in the projected result", async () => {
    const { storage } = storageStub();
    const urls = await new MediaUrlService(storage).sign(readyMedia());
    expect(Object.keys(urls).sort()).toEqual(["expiresAt", "motionUrl", "thumbUrl", "url"]);
    expect(JSON.stringify(urls)).not.toMatch(/variants|"key"|"bucket"/);
  });

  it("falls back to the stored original key when no variants were processed", async () => {
    const { storage, calls } = storageStub();
    const urls = await new MediaUrlService(storage).sign(readyMedia({ variants: {} }));

    expect(urls.url).toContain("original.jpg");
    expect(urls.thumbUrl).toContain("original.jpg");
    expect(calls.map((call) => call.key)).toEqual(["ws/2026/11/media/original.jpg"]);
  });

  it("does not sign media that is not ready", async () => {
    const { storage, calls } = storageStub();
    const urls = await new MediaUrlService(storage).sign(
      readyMedia({ status: "processing" }),
    );

    expect(urls).toEqual({ url: null, thumbUrl: null, motionUrl: null, expiresAt: null });
    expect(calls).toEqual([]);
  });

  it("does not sign ready rows that have no object key", async () => {
    const { storage, calls } = storageStub();
    const urls = await new MediaUrlService(storage).sign(readyMedia({ key: "" }));

    expect(urls).toEqual({ url: null, thumbUrl: null, motionUrl: null, expiresAt: null });
    expect(calls).toEqual([]);
  });

  it("signs each object key once per batch, even across duplicated rows", async () => {
    const { storage, calls } = storageStub();
    const service = new MediaUrlService(storage);
    const signed = await service.signMany([
      readyMedia(),
      readyMedia(),
      readyMedia({ id: OTHER_MEDIA_ID }),
    ]);

    expect(signed.size).toBe(2);
    expect(calls.map((call) => call.key).sort()).toEqual([
      "ws/2026/11/media/large.webp",
      "ws/2026/11/media/thumb.webp",
    ]);
  });

  it("reports the earliest expiry when variants expire at different times", async () => {
    const { storage } = storageStub((key) =>
      key.endsWith("thumb.webp") ? "2026-11-18T10:00:00.000Z" : "2026-11-18T12:00:00.000Z",
    );
    const urls = await new MediaUrlService(storage).sign(readyMedia());
    expect(urls.expiresAt).toBe("2026-11-18T10:00:00.000Z");
  });

  it("rejects traversal keys instead of signing them", async () => {
    const { storage } = storageStub();
    await expect(
      new MediaUrlService(storage).sign(
        readyMedia({ key: "../secret/photo.jpg", variants: {} }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("signs every row against its own bucket, not the current configuration", async () => {
    const { storage, calls } = storageStub();
    const service = new MediaUrlService(storage);

    const signed = await service.signMany([
      readyMedia(),
      readyMedia({
        id: OTHER_MEDIA_ID,
        bucket: BUCKET_B,
        key: "ws/2026/11/old/original.jpg",
        variants: {},
      }),
    ]);

    expect(signed.get(MEDIA_ID)?.url).toContain(`/${BUCKET_A}/`);
    expect(signed.get(OTHER_MEDIA_ID)?.url).toContain(`/${BUCKET_B}/`);
    expect(calls.every((call) => call.bucket !== undefined)).toBe(true);
    expect(calls.map((call) => call.bucket)).toContain(BUCKET_A);
    expect(calls.map((call) => call.bucket)).toContain(BUCKET_B);
  });

  it("falls back to the current bucket and warns once per window for legacy rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T00:00:00.000Z"));
    try {
      const warn = vi.fn();
      const { storage, calls } = storageStub();
      const service = new MediaUrlService(storage, { warn } as unknown as PinoLoggerService);

      const urls = await service.sign(readyMedia({ bucket: null }));
      // No explicit bucket argument = let StorageService use the current bucket.
      expect(calls[0]?.bucket).toBeUndefined();
      expect(urls.url).toContain("/current-bucket/");

      // A second legacy row inside the throttle window stays silent.
      await service.sign(readyMedia({ bucket: "" }));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[1]).toBe("media.bucket_missing");
      expect(warn.mock.calls[0]?.[0]).toMatchObject({ code: "MEDIA_BUCKET_MISSING" });

      // After the window another warning is allowed.
      vi.setSystemTime(new Date(Date.now() + 61_000));
      await service.sign(readyMedia({ bucket: null }));
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs an arbitrary key set for one row in that row's bucket", async () => {
    const { storage, calls } = storageStub();
    const service = new MediaUrlService(storage);

    const signed = await service.signKeys(readyMedia(), [
      "ws/2026/11/media/original.jpg",
      "ws/2026/11/media/large.webp",
      "ws/2026/11/media/original.jpg",
    ]);

    expect([...signed.keys()].sort()).toEqual([
      "ws/2026/11/media/large.webp",
      "ws/2026/11/media/original.jpg",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.bucket === BUCKET_A)).toBe(true);
  });
});