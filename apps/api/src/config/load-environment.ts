import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

function loadFile(path: string): void {
  const values = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadEnvironmentFiles(): string | undefined {
  if (process.env.NODE_ENV === "test") {
    return undefined;
  }

  const explicitPath = process.env.ROAMLOG_ENV_FILE;
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (!existsSync(resolved)) {
      throw new Error(`ROAMLOG_ENV_FILE does not exist: ${resolved}`);
    }
    loadFile(resolved);
    return resolved;
  }

  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    for (const filename of [".env.local", ".env"]) {
      const candidate = resolve(directory, filename);
      if (existsSync(candidate)) {
        loadFile(candidate);
        return candidate;
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  return undefined;
}
