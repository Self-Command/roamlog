#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function assertMatch(value, pattern, label) {
  if (!pattern.test(value)) {
    throw new Error(`${label} has an invalid value: ${value}`);
  }
}

const component = requiredEnv("RELEASE_COMPONENT");
const image = requiredEnv("RELEASE_IMAGE");
const digest = requiredEnv("RELEASE_DIGEST");
const platform = requiredEnv("RELEASE_PLATFORM");
const dockerfile = requiredEnv("RELEASE_DOCKERFILE");
const target = requiredEnv("RELEASE_TARGET");
const revision = requiredEnv("RELEASE_REVISION");
const source = requiredEnv("RELEASE_SOURCE");
const outputDirectory = requiredEnv("RELEASE_OUTPUT_DIR");

assertMatch(component, /^[a-z][a-z0-9-]*$/, "RELEASE_COMPONENT");
assertMatch(digest, /^sha256:[0-9a-f]{64}$/, "RELEASE_DIGEST");
assertMatch(revision, /^[0-9a-f]{40}$/i, "RELEASE_REVISION");
assertMatch(platform, /^linux\/(?:amd64|arm64)$/, "RELEASE_PLATFORM");

if (!image.endsWith(`/${component}`)) {
  throw new Error(`RELEASE_IMAGE must end with /${component}: ${image}`);
}

const tags = requiredEnv("RELEASE_TAGS")
  .split(/\r?\n/)
  .map((tag) => tag.trim())
  .filter(Boolean);

if (tags.length === 0) {
  throw new Error("RELEASE_TAGS must contain at least one image tag");
}
if (new Set(tags).size !== tags.length) {
  throw new Error("RELEASE_TAGS contains duplicate tags");
}

for (const tag of tags) {
  if (!tag.startsWith(`${image}:`)) {
    throw new Error(`Image tag must reference ${image}: ${tag}`);
  }
  assertMatch(tag.slice(image.length + 1), /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "image tag");
}

const manifest = {
  component,
  image,
  tags,
  digest,
  platform,
  dockerfile,
  target,
  revision,
  source,
};

await mkdir(outputDirectory, { recursive: true });
const outputPath = join(outputDirectory, `${component}.json`);
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
