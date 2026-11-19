import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { MediaUrlService, type MediaUrlSource } from "../media-url.service.js";
import type { SignedReadUrl, StorageService } from "../../storage/storage.service.js";

const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const OTHER_MEDIA_ID = "01942f30-1200-7000-8000-000000000011";
const DEFAULT_EXPIRY = "2026-11-18T12:00:00.000Z";

function storageStub(expiresAt: (key: string) => string = () => DEFAULT_EXPIRY) {
  const calls: string[] = [];
  const storage = {
    createSignedReadUrl: async (key: string): Promise<SignedReadUrl> => {
      calls.push(key);
      return {
        url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
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
    expect(calls.sort()).toEqual([
      "ws/2026/11/media/large.webp",
      "ws/2026/11/media/thumb.webp",
    ]);
  });

  it("returns no storage coordinates or variant map in the projected result", async () => {
    const { storage } = storageStub();
    const urls = await new MediaUrlService(storage).sign(readyMedia());
    expect(Object.keys(urls).sort()).toEqual(["expiresAt", "motionUrl", "thumbUrl", "url"]);
    expect(JSON.stringify(urls)).not.toMatch(/bucket|variants|"key"/);
  });

  it("falls back to the stored original key when no variants were processed", async () => {
    const { storage, calls } = storageStub();
    const urls = await new MediaUrlService(storage).sign(readyMedia({ variants: {} }));

    expect(urls.url).toContain("original.jpg");
    expect(urls.thumbUrl).toContain("original.jpg");
    expect(calls).toEqual(["ws/2026/11/media/original.jpg"]);
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
    expect(calls.sort()).toEqual([
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
});
