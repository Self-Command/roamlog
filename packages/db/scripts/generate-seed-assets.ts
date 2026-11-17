import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { seedAssetFiles } from "../src/seed/assets.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(packageRoot, "seed-assets");
const force = process.argv.includes("--force");

mkdirSync(outputDirectory, { recursive: true });

for (const [index, asset] of seedAssetFiles.entries()) {
  const outputPath = path.join(outputDirectory, asset.fileName);
  if (existsSync(outputPath) && !force) {
    continue;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${asset.startColor}" />
          <stop offset="1" stop-color="${asset.endColor}" />
        </linearGradient>
        <radialGradient id="glow" cx="72%" cy="24%" r="62%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.18" />
          <stop offset="1" stop-color="#000000" stop-opacity="0" />
        </radialGradient>
        <pattern id="grain" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.55" fill="#ffffff" fill-opacity="0.07" />
        </pattern>
      </defs>
      <rect width="1200" height="800" fill="url(#base)" />
      <rect width="1200" height="800" fill="url(#glow)" />
      <rect width="1200" height="800" fill="url(#grain)" />
      <path d="M0 604 L246 510 L430 566 L680 412 L928 478 L1200 354 L1200 800 L0 800 Z"
        fill="#050505" fill-opacity="0.24" />
      <line x1="72" y1="92" x2="1128" y2="92" stroke="#ffffff" stroke-opacity="0.18" />
      <text x="72" y="145" fill="#f4f1ea" font-family="monospace" font-size="21"
        letter-spacing="7">ROAMLOG / LOCAL SEED</text>
      <text x="72" y="680" fill="#f4f1ea" font-family="Georgia, serif"
        font-size="78" letter-spacing="-2">${asset.label}</text>
      <text x="76" y="735" fill="#f4f1ea" fill-opacity="0.68"
        font-family="monospace" font-size="18" letter-spacing="4">
        ${String(index + 1).padStart(2, "0")} / 08 · 1200 × 800
      </text>
      <circle cx="1080" cy="700" r="4" fill="#ffffff" fill-opacity="0.75" />
    </svg>
  `;

  const jpeg = await sharp(Buffer.from(svg))
    .jpeg({ quality: 68, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();
  writeFileSync(outputPath, jpeg);
  console.log(
    `generated seed-assets/${asset.fileName} (${jpeg.byteLength.toLocaleString()} bytes)`,
  );
}
