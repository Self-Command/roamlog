import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSeedDataset, seedAssetFiles } from "../../seed-data.js";

const seedAssetsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../seed-assets");

interface OriginalVariant {
  key: string;
  width: number;
  height: number;
}

describe("seed media variants", () => {
  const data = buildSeedDataset();

  it("keeps exactly 24 seed photos", () => {
    expect(data.media).toHaveLength(24);
  });

  it("only declares the uploaded original variant", () => {
    for (const item of data.media) {
      expect(Object.keys(item.variants), item.id).toEqual(["original"]);
      expect(item.variants, item.id).not.toHaveProperty("thumb");
      expect(item.variants, item.id).not.toHaveProperty("display");
      expect(item.variants, item.id).not.toHaveProperty("localFallback");
    }
  });

  it("points every original variant at an existing seed asset", () => {
    const assetFileNames = new Set(seedAssetFiles.map((asset) => asset.fileName));
    const keys = new Set<string>();

    data.media.forEach((item, index) => {
      const original = item.variants.original as OriginalVariant | undefined;
      expect(original, item.id).toEqual({
        key: item.key,
        width: 1200,
        height: 800,
      });
      expect(original?.key, item.id).toMatch(/^seed\/[a-z0-9-]+-\d{2}\.jpg$/u);
      expect(keys.has(item.key), `${item.key} must be unique`).toBe(false);
      keys.add(item.key);

      expect(assetFileNames.has(item.assetFileName), item.assetFileName).toBe(true);
      const assetBase = item.assetFileName.replace(/\.jpg$/u, "");
      expect(item.key).toBe(`seed/${assetBase}-${String(index + 1).padStart(2, "0")}.jpg`);
      expect(existsSync(join(seedAssetsDir, item.assetFileName)), item.assetFileName).toBe(true);
    });

    expect(keys.size).toBe(24);
  });
});
