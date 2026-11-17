import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { LIVE_ROOT } from "./env";

type AppName = "web" | "admin";

const requested = process.argv[2];
if (requested !== "web" && requested !== "admin") {
  throw new Error("Usage: prepare-next-runtime.ts <web|admin>");
}
const appName: AppName = requested;

const sourceRoot = resolve(LIVE_ROOT, "apps", appName);
const runtimeRoot = resolve(LIVE_ROOT, ".e2e-live/runtime", appName);
const sourceNodeModules = resolve(sourceRoot, "node_modules");
const runtimeNodeModules = resolve(runtimeRoot, "node_modules");
const runtimeNext = resolve(runtimeRoot, ".next");

mkdirSync(runtimeRoot, { recursive: true });
rmSync(runtimeNext, { force: true, recursive: true });
cpSync(sourceRoot, runtimeRoot, {
  recursive: true,
  force: true,
  filter(source) {
    const resolved = resolve(source);
    return !(
      resolved === resolve(sourceRoot, ".next") ||
      resolved.startsWith(`${resolve(sourceRoot, ".next")}\\`) ||
      resolved.startsWith(`${resolve(sourceRoot, ".next")}/`) ||
      resolved === sourceNodeModules ||
      resolved === resolve(sourceRoot, ".turbo") ||
      resolved.startsWith(`${resolve(sourceRoot, ".turbo")}\\`) ||
      resolved.startsWith(`${resolve(sourceRoot, ".turbo")}/`) ||
      resolved === resolve(sourceRoot, "tsconfig.tsbuildinfo")
    );
  },
});

if (!existsSync(runtimeNodeModules)) {
  symlinkSync(
    sourceNodeModules,
    runtimeNodeModules,
    process.platform === "win32" ? "junction" : "dir",
  );
} else if (!lstatSync(runtimeNodeModules).isSymbolicLink()) {
  throw new Error(`Refusing to replace non-symlink runtime node_modules: ${runtimeNodeModules}`);
}

const tsconfigPath = resolve(runtimeRoot, "tsconfig.json");
const baseTsconfig = JSON.parse(readFileSync(resolve(LIVE_ROOT, "tsconfig.base.json"), "utf8")) as {
  compilerOptions?: Record<string, unknown>;
};
const appTsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  [key: string]: unknown;
};
const { extends: _ignoredExtends, ...appConfig } = appTsconfig;
const tsconfig = {
  ...appConfig,
  compilerOptions: {
    ...(baseTsconfig.compilerOptions ?? {}),
    ...(appTsconfig.compilerOptions ?? {}),
  },
};
writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

console.log(`Prepared isolated Next ${appName} runtime at ${runtimeRoot}`);
