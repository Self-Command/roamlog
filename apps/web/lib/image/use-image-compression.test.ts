import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CompressionResult,
  ImageCompressionProgress,
} from "./compress-image";
import type { CompressWorkerRequest } from "./compress-image-protocol";

class FakeOffscreenCanvas {
  convertToBlob(): Promise<Blob> {
    return Promise.resolve(new Blob());
  }
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: CompressWorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: CompressWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitResult(result: CompressionResult): void {
    const request = this.messages.at(-1);
    if (!request) throw new Error("No request was posted");
    this.onmessage?.({ data: { type: "result", id: request.id, result } } as MessageEvent);
  }

  emitProgress(progress: ImageCompressionProgress): void {
    const request = this.messages.at(-1);
    if (!request) throw new Error("No request was posted");
    this.onmessage?.({ data: { type: "progress", id: request.id, progress } } as MessageEvent);
  }

  emitLoadError(message = "worker failed"): void {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
}

function makeResult(): CompressionResult {
  return {
    full: new Blob(["compressed"], { type: "image/webp" }),
    thumb: new Blob(["thumb"], { type: "image/webp" }),
    width: 2000,
    height: 1333,
    blurhash: "LEHV6nWB2yk8",
    quality: 0.82,
    iterations: 1,
    skipped: false,
    originalBytes: 2048,
    compressedBytes: 10,
    elapsedMs: 1,
  };
}

async function loadCompressor() {
  vi.resetModules();
  return import("./use-image-compression");
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("createImageBitmap", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compressImage worker lifecycle", () => {
  it("serializes concurrent jobs through one worker and forwards progress", async () => {
    const { compressImage } = await loadCompressor();
    const file = new File(["image"], "cover.jpg", { type: "image/jpeg" });
    const firstProgress: ImageCompressionProgress[] = [];

    const first = compressImage(file, {
      onProgress: (progress) => firstProgress.push(progress),
    });
    const second = compressImage(file);

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    if (!worker) throw new Error("Worker was not constructed");
    expect(worker.messages).toHaveLength(1);
    expect(worker.messages[0]).toMatchObject({
      maxEdge: 2000,
      targetBytes: 1_500_000,
      quality: 0.82,
    });
    expect(worker.options.type).toBe("module");

    worker.emitProgress({
      percent: 42,
      stage: "encoding",
      iteration: 1,
      quality: 0.82,
    });
    expect(firstProgress).toEqual([
      { percent: 42, stage: "encoding", iteration: 1, quality: 0.82 },
    ]);

    const result = makeResult();
    worker.emitResult(result);
    await expect(first).resolves.toBe(result);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));

    const secondResult = makeResult();
    worker.emitResult(secondResult);
    await expect(second).resolves.toBe(secondResult);
    expect(worker.terminated).toBe(false);
  });

  it("forwards the media policy values to the worker request", async () => {
    const { compressImage } = await loadCompressor();
    const promise = compressImage(
      new File(["image"], "cover.jpg", { type: "image/jpeg" }),
      { maxEdge: 1200, quality: 0.9, targetBytes: 900_000 },
    );

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    if (!worker) throw new Error("Worker was not constructed");

    expect(worker.messages[0]).toMatchObject({
      maxEdge: 1200,
      quality: 0.9,
      targetBytes: 900_000,
    });

    worker.emitResult(makeResult());
    await expect(promise).resolves.toBeDefined();
  });

  it("terminates the worker and rejects when the caller aborts", async () => {
    const { compressImage } = await loadCompressor();
    const controller = new AbortController();
    const promise = compressImage(
      new File(["image"], "cover.jpg", { type: "image/jpeg" }),
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    if (!worker) throw new Error("Worker was not constructed");
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("degrades to a source-only upload when neither Worker nor Canvas 2D exists", async () => {
    vi.unstubAllGlobals();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { compressImage } = await loadCompressor();
    const file = new File(["image"], "cover.jpg", { type: "image/jpeg" });

    const result = await compressImage(file);

    expect(result.skipped).toBe(true);
    expect(result.full).toBe(file);
    expect(result.originalBytes).toBe(file.size);
    expect(result.compressedBytes).toBe(file.size);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("跳过压缩"),
    );
  });

  it("falls back to the main-thread/no-canvas path when the Worker fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { compressImage } = await loadCompressor();
    const file = new File(["image"], "cover.jpg", { type: "image/jpeg" });
    const promise = compressImage(file);

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    if (!worker) throw new Error("Worker was not constructed");
    worker.emitLoadError("unsupported worker URL");

    const result = await promise;
    expect(result.skipped).toBe(true);
    expect(result.full).toBe(file);
    expect(worker.terminated).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("回退到主线程压缩"),
      "图片压缩 Worker 加载失败。",
    );
  });
});