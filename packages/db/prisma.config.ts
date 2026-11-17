import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRootEnv = path.resolve(packageRoot, "../../.env.local");

if (existsSync(workspaceRootEnv)) {
  process.loadEnvFile(workspaceRootEnv);
}

const fallbackDatabaseUrl =
  "postgresql://roamlog:roamlog@localhost:5432/roamlog?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? fallbackDatabaseUrl,
  },
});
