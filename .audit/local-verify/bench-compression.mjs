#!/usr/bin/env node
/**
 * D1 compression benchmark.
 *
 * Bundles the real Worker with esbuild, serves it from a tiny local HTTP server,
 * generates three JPEGs in Chromium (no network images), then measures each
 * compression from the main thread:
 *   - original -> compressed bytes, quality, ladder iterations, elapsed time
 *   - long tasks observed by PerformanceObserver
 *   - max requestAnimationFrame gap while the Worker runs
 *
 * Run: node .audit/local-verify/bench-compression.mjs
 */
import { createServer } from "node:http";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { chromium } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER_ENTRY = path.join(
  ROOT,
  "apps/web/lib/image/compress-image.worker.ts",
);

async function loadEsbuild() {
  const pnpmDir = path.join(ROOT, "node_modules/.pnpm");
  const packageDir = readdirSync(pnpmDir).find((name) => /^esbuild@/.test(name));
  if (!packageDir) throw new Error("esbuild package not found under node_modules/.pnpm");
  const modulePath = path.join(pnpmDir, packageDir, "node_modules/esbuild/lib/main.js");
  return import(pathToFileURL(modulePath).href);
}

function table(rows) {
  const header = [
    "image",
    "original",
    "compressed",
    "quality",
    "tries",
    "elapsed",
    "long tasks",
    "max frame gap",
    "skipped",
  ];
  const body = rows.map((row) => [
    row.label,
    formatBytes(row.originalBytes),
    formatBytes(row.compressedBytes),
    row.skipped ? "source" : row.quality.toFixed(2),
    String(row.iterations),
    `${row.elapsedMs} ms`,
    String(row.longTasks),
    `${Math.round(row.maxFrameGapMs)} ms`,
    row.skipped ? "yes" : "no",
  ]);
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...body.map((line) => line[index].length)),
  );
  const line = (cells) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [line(header), widths.map((width) => "─".repeat(width)).join("  "), ...body.map(line)].join(
    "\n",
  );
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function main() {
  const esbuild = await loadEsbuild();
  const build = await esbuild.build({
    entryPoints: [WORKER_ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    write: false,
    minify: true,
    logLevel: "silent",
  });
  const workerCode = build.outputFiles[0].text;

  const server = createServer((request, response) => {
    if (request.url === "/worker.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(workerCode);
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body><main id="app">benchmark</main></body></html>`);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(180_000);

  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    const output = await page.evaluate(async () => {
      async function jpegBlob(canvas, quality) {
        return new Promise((resolve, reject) => {
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encode failed"))),
            "image/jpeg",
            quality,
          );
        });
      }

      function noiseCanvas(width, height, seed) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        const image = context.createImageData(width, height);
        let state = seed >>> 0;
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          state = (state * 1664525 + 1013904223) >>> 0;
          const offset = pixel * 4;
          image.data[offset] = state & 0xff;
          image.data[offset + 1] = (state >>> 8) & 0xff;
          image.data[offset + 2] = (state >>> 16) & 0xff;
          image.data[offset + 3] = 255;
        }
        context.putImageData(image, 0, 0);
        return canvas;
      }

      function gradientCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#1d4ed8");
        gradient.addColorStop(0.5, "#f59e0b");
        gradient.addColorStop(1, "#052e16");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
        return canvas;
      }

      async function makeJpeg(label, width, height, quality, kind = "noise") {
        const canvas = kind === "gradient" ? gradientCanvas(width, height) : noiseCanvas(width, height, width * 7 + height);
        const blob = await jpegBlob(canvas, quality);
        return {
          label,
          file: new File([blob], `${label}.jpg`, { type: "image/jpeg" }),
          originalBytes: blob.size,
          width,
          height,
        };
      }

      // The large image is deliberately near the 25MB upload ceiling. JPEG
      // quality is binary-searched for the first result at or above 25MB.
      const largeCanvas = noiseCanvas(5800, 3900, 5800 * 7 + 3900);
      let lowQuality = 0.9;
      let highQuality = 1;
      let largeBlob = await jpegBlob(largeCanvas, 1);
      const targetOriginal = 25 * 1024 * 1024;
      let closestBlob = largeBlob;
      let closestDistance = Math.abs(largeBlob.size - targetOriginal);
      for (let attempt = 0; attempt < 16 && largeBlob.size > 25.5 * 1024 * 1024; attempt += 1) {
        const quality = (lowQuality + highQuality) / 2;
        const candidate = await jpegBlob(largeCanvas, quality);
        const distance = Math.abs(candidate.size - targetOriginal);
        if (distance < closestDistance) {
          closestBlob = candidate;
          closestDistance = distance;
        }
        if (candidate.size >= targetOriginal) {
          largeBlob = candidate;
          highQuality = quality;
        } else {
          lowQuality = quality;
        }
      }
      largeBlob = closestBlob;
      const large = {
        label: "5800x3900",
        file: new File([largeBlob], "5800x3900.jpg", { type: "image/jpeg" }),
        originalBytes: largeBlob.size,
        width: 5800,
        height: 3900,
      };
      const medium = await makeJpeg("3000x2000", 3000, 2000, 0.72);
      const small = await makeJpeg("900x600", 900, 600, 0.62, "gradient");

      async function compressOne(image) {
        const longTasks = [];
        let maxFrameGapMs = 0;
        let running = true;
        let lastFrame = performance.now();

        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ entryTypes: ["longtask"] });

        const frame = (now) => {
          maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrame);
          lastFrame = now;
          if (running) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);

        const startedAt = performance.now();
        const result = await new Promise((resolve, reject) => {
          const worker = new Worker("/worker.js");
          const id = 1;
          worker.onmessage = (event) => {
            const message = event.data;
            if (!message || message.id !== id) return;
            if (message.type === "progress") return;
            worker.terminate();
            if (message.type === "error") {
              reject(new Error(`${message.error.code}: ${message.error.message}`));
              return;
            }
            resolve(message.result);
          };
          worker.onerror = (event) => {
            worker.terminate();
            reject(new Error(`worker error: ${event.message}`));
          };
          worker.postMessage({
            id,
            file: image.file,
            maxEdge: 2000,
            targetBytes: 1_500_000,
          });
        });
        const elapsedMs = Math.round(performance.now() - startedAt);
        running = false;
        observer.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 50));

        return {
          label: image.label,
          originalBytes: image.originalBytes,
          compressedBytes: result.full.size,
          quality: result.quality,
          iterations: result.iterations,
          width: result.width,
          height: result.height,
          skipped: result.skipped,
          elapsedMs,
          longTasks: longTasks.length,
          longTaskDurations: longTasks.map((duration) => Math.round(duration)),
          maxFrameGapMs,
        };
      }

      const results = [];
      for (const image of [large, medium, small]) {
        results.push(await compressOne(image));
      }

      // Chromium cannot decode HEIC. A synthetic HEIC-typed payload that no
      // decoder can read exercises the Worker's explicit failure classification.
      const decodeFailure = await new Promise((resolve, reject) => {
        const worker = new Worker("/worker.js");
        const id = 99;
        const fakeHeic = new File(
          [new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99])],
          "IMG_0001.HEIC",
          { type: "image/heic" },
        );
        worker.onmessage = (event) => {
          const message = event.data;
          if (!message || message.id !== id || message.type === "progress") return;
          worker.terminate();
          if (message.type === "error") resolve(message.error);
          else reject(new Error("Synthetic HEIC unexpectedly decoded"));
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(`worker error: ${event.message}`));
        };
        worker.postMessage({ id, file: fakeHeic, maxEdge: 2000, targetBytes: 1_500_000 });
      });

      return { results, decodeFailure };
    });

    console.log("\nRoamlog D1 client compression benchmark");
    console.log(`worker bundle: ${(workerCode.length / 1024).toFixed(1)} KB`);
    console.log(table(output.results));
    console.log(
      `\nHEIC decode failure: ${output.decodeFailure.code} — ${output.decodeFailure.message}`,
    );
    console.log("\nraw JSON:");
    console.log(JSON.stringify(output, null, 2));
    if (output.results[0]?.skipped) {
      throw new Error("The 25MB fixture was skipped; check image generation.");
    }
    if (output.results[2] && !output.results[2].skipped) {
      throw new Error("The small fixture should have skipped re-compression.");
    }
    if (output.decodeFailure.code !== "DECODE_FAILED") {
      throw new Error("Undecodable HEIC did not produce DECODE_FAILED.");
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});