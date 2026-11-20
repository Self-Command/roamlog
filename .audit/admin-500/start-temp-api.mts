import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const repo = "C:/Users/BY9700/Desktop/UI/roamlog";
const parsed = parseEnv(readFileSync(`${repo}/.env.local`, "utf8"));
const env = {
  ...process.env,
  ...parsed,
  DATABASE_URL: "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public",
  API_PORT: "4100",
  API_URL: "http://127.0.0.1:4100",
  BETTER_AUTH_URL: "http://127.0.0.1:4100",
  LOG_LEVEL: "warn",
};

const child = spawn(
  process.execPath,
  [`${repo}/node_modules/tsx/dist/cli.mjs`, "src/main.ts"],
  { cwd: `${repo}/apps/api`, env, stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  process.stderr.write(`temp-api exited code=${code} signal=${signal}\n`);
  process.exit(code ?? 1);
});