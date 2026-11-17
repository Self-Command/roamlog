import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenApiDocument } from "./generate-openapi";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diff(
  expected: unknown,
  actual: unknown,
  location: string,
  output: string[],
): void {
  if (output.length >= 25) return;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      output.push(`${location}: expected ${Array.isArray(expected) ? "array" : "non-array"}`);
      return;
    }
    if (expected.length !== actual.length) {
      output.push(`${location}: array length ${expected.length} -> ${actual.length}`);
    }
    const length = Math.min(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      diff(expected[index], actual[index], `${location}[${index}]`, output);
    }
    return;
  }

  if (isRecord(expected) || isRecord(actual)) {
    if (!isRecord(expected) || !isRecord(actual)) {
      output.push(`${location}: expected ${isRecord(expected) ? "object" : "non-object"}`);
      return;
    }
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!(key in expected)) {
        output.push(`${location}.${key}: unexpected in generated document`);
      } else if (!(key in actual)) {
        output.push(`${location}.${key}: missing from generated document`);
      } else {
        diff(expected[key], actual[key], `${location}.${key}`, output);
      }
    }
    return;
  }

  if (!Object.is(expected, actual)) {
    output.push(`${location}: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`);
  }
}

const committedPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
const relativePath = path.relative(process.cwd(), committedPath);

let committed: unknown;
try {
  committed = JSON.parse(readFileSync(committedPath, "utf8"));
} catch (error) {
  console.error(
    `OpenAPI contract check failed: could not read ${relativePath}. Run contracts:generate first.\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

const generated = buildOpenApiDocument();
const differences: string[] = [];
diff(committed, generated, "openapi", differences);

if (differences.length > 0) {
  console.error(
    `OpenAPI drift detected in ${relativePath}. Run \`pnpm --filter @roamlog/contracts contracts:generate\` and review the diff.`,
  );
  for (const difference of differences) {
    console.error(`- ${difference}`);
  }
  process.exit(1);
}

console.log(
  `OpenAPI contract is fresh: ${Object.keys(generated.paths ?? {}).length} paths, ${
    Object.keys(generated.components?.schemas ?? {}).length
  } schemas.`,
);
