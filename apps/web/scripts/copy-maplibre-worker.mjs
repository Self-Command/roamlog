import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("maplibre-gl/package.json");
const packageRoot = path.dirname(packageJsonPath);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(packageRoot, "dist", "maplibre-gl-worker.mjs");
const publicDir = path.join(appRoot, "public");
const target = path.join(publicDir, "maplibre-gl-worker.mjs");

await mkdir(publicDir, { recursive: true });
await copyFile(source, target);
