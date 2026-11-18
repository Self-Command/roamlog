#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const COMPONENT_ORDER = ["api", "migrate", "worker", "web", "admin"];
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatTag(imageRef) {
  const tag = imageRef.slice(imageRef.lastIndexOf(":") + 1);
  assert(TAG_PATTERN.test(tag), `Invalid image tag in manifest: ${imageRef}`);
  return `\`${imageRef}\``;
}

const generatedNotesPath = requiredEnv("GENERATED_NOTES_JSON");
const manifestDirectory = requiredEnv("IMAGE_MANIFEST_DIR");
const releaseSha = requiredEnv("RELEASE_SHA");
const qualityGateUrl = requiredEnv("QUALITY_GATE_URL");
const outputPath = requiredEnv("RELEASE_OUTPUT");
const releaseTag = requiredEnv("RELEASE_TAG");
const repository = requiredEnv("GITHUB_REPOSITORY");

assert(/^[0-9a-f]{40}$/i.test(releaseSha), `RELEASE_SHA is invalid: ${releaseSha}`);
assert(TAG_PATTERN.test(releaseTag), `RELEASE_TAG is invalid: ${releaseTag}`);

const generatedPayload = JSON.parse(await readFile(generatedNotesPath, "utf8"));
const generatedBody = typeof generatedPayload.body === "string" ? generatedPayload.body.trim() : "";
assert(generatedBody.length > 0, "GitHub returned empty generated release notes");

const manifestFiles = (await readdir(manifestDirectory))
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();
assert(manifestFiles.length === COMPONENT_ORDER.length, "Expected five image manifests");

const manifests = [];
for (const fileName of manifestFiles) {
  const manifest = JSON.parse(await readFile(join(manifestDirectory, fileName), "utf8"));
  manifests.push(manifest);
}

const byComponent = new Map();
for (const manifest of manifests) {
  assert(
    typeof manifest.component === "string" && COMPONENT_ORDER.includes(manifest.component),
    `Unknown manifest component: ${manifest.component}`,
  );
  assert(!byComponent.has(manifest.component), `Duplicate manifest for ${manifest.component}`);
  assert(
    typeof manifest.digest === "string" && DIGEST_PATTERN.test(manifest.digest),
    `${manifest.component} has an invalid digest`,
  );
  assert(manifest.platform === "linux/amd64", `${manifest.component} is not linux/amd64`);
  assert(
    Array.isArray(manifest.tags) && manifest.tags.length > 0,
    `${manifest.component} has no image tags`,
  );
  assert(
    manifest.tags.includes(`${manifest.image}:${releaseTag}`),
    `${manifest.component} is missing the release tag ${releaseTag}`,
  );
  byComponent.set(manifest.component, manifest);
}

for (const component of COMPONENT_ORDER) {
  assert(byComponent.has(component), `Missing image manifest for ${component}`);
}

const expectedImagePrefix = `ghcr.io/${repository.toLowerCase()}/`;
for (const manifest of manifests) {
  assert(
    manifest.image.startsWith(expectedImagePrefix),
    `Unexpected image registry path: ${manifest.image}`,
  );
  assert(
    manifest.image === `${expectedImagePrefix}${manifest.component}`,
    `Unexpected image name for ${manifest.component}: ${manifest.image}`,
  );
}

const orderedManifests = COMPONENT_ORDER.map((component) => byComponent.get(component));
const imageTable = [
  "| Component | Image | Tags | Digest |",
  "| --- | --- | --- | --- |",
  ...orderedManifests.map(
    (manifest) =>
      `| ${manifest.component} | \`${manifest.image}\` | ${manifest.tags.map(formatTag).join("<br>")} | \`${manifest.digest}\` |`,
  ),
].join("\n");

const pullCommands = orderedManifests
  .map((manifest) => `docker pull ${manifest.image}:${releaseTag}`)
  .join("\n");

const body = `${generatedBody}

---

## Container images

All five images were built for **linux/amd64** from commit \`${releaseSha}\` and published to GitHub Container Registry.

${imageTable}

### Pull the release

\`\`\`bash
${pullCommands}
\`\`\`

### Supply-chain attestations

Publishing used BuildKit \`provenance: mode=max\` and \`sbom: true\`. The provenance and SBOM attestations are attached to the OCI image manifests in GHCR. They are not copied into the repository or duplicated as release assets.

Inspect an attestation with Buildx:

\`\`\`bash
docker buildx imagetools inspect ${orderedManifests[0].image}:${releaseTag} --format '{{json .Provenance}}'
docker buildx imagetools inspect ${orderedManifests[0].image}:${releaseTag} --format '{{json .SBOM}}'
\`\`\`

GHCR package visibility is controlled under package settings. If anonymous pulls are required, an owner or administrator must make each linked package public after the first publish; this workflow does not change package visibility.

## Release evidence

- Quality gate: ${qualityGateUrl}
- Source commit: \`${releaseSha}\`
- Release tag: \`${releaseTag}\`
`;

await writeFile(outputPath, body, "utf8");
console.log(`Wrote ${outputPath}`);
