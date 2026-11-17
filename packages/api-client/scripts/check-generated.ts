import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "orval";
import type { Options, OutputOptions } from "orval";

import orvalConfig, { GENERATED_DIR } from "../orval.config";

function listFiles(root: string): string[] {
  const output: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        output.push(relative(root, absolute).replaceAll("\\", "/"));
      }
    }
  }

  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    walk(root);
  }
  return output.sort();
}

function compareTrees(expectedRoot: string, actualRoot: string, label: string): string[] {
  const expected = new Set(listFiles(expectedRoot));
  const actual = new Set(listFiles(actualRoot));
  const differences: string[] = [];

  for (const file of expected) {
    if (!actual.has(file)) {
      differences.push(`${label}/${file}: missing from fresh generation`);
      continue;
    }
    const expectedSource = readFileSync(join(expectedRoot, file), "utf8");
    const actualSource = readFileSync(join(actualRoot, file), "utf8");
    if (expectedSource !== actualSource) {
      differences.push(`${label}/${file}: differs from fresh generation`);
    }
  }
  for (const file of actual) {
    if (!expected.has(file)) {
      differences.push(`${label}/${file}: generated but not committed`);
    }
  }

  return differences;
}

async function main(): Promise<void> {
  const project = (orvalConfig as Record<string, Options | undefined>).roamlog;
  if (!project || typeof project.output !== "object" || project.output === null) {
    throw new Error("orval.config.ts must define an object output for the roamlog project.");
  }

  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const temporaryRoot = mkdtempSync(join(packageRoot, ".orval-check-"));
  const temporaryOutput: OutputOptions = {
    ...project.output,
    target: join(temporaryRoot, "endpoints"),
    schemas: join(temporaryRoot, "schemas"),
    clean: true,
  };

  try {
    await generate(
      {
        ...project,
        output: temporaryOutput,
      },
      packageRoot,
      { throwOnError: true },
    );

    const committedRoot = join(packageRoot, GENERATED_DIR);
    const differences = [
      ...compareTrees(
        join(committedRoot, "endpoints"),
        join(temporaryRoot, "endpoints"),
        "endpoints",
      ),
      ...compareTrees(
        join(committedRoot, "schemas"),
        join(temporaryRoot, "schemas"),
        "schemas",
      ),
    ];

    if (differences.length > 0) {
      console.error(
        "Generated API client is stale. Run `pnpm --filter @roamlog/api-client api-client:generate` and review the diff.",
      );
      for (const difference of differences.slice(0, 40)) {
        console.error(`- ${difference}`);
      }
      if (differences.length > 40) {
        console.error(`- ...and ${differences.length - 40} more differences`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      `Generated API client is fresh: ${listFiles(join(committedRoot, "endpoints")).length} endpoint files, ${
        listFiles(join(committedRoot, "schemas")).length
      } schema files.`,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
