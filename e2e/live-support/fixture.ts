import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { LIVE_ADMIN_URL, LIVE_FIXTURE_FILE, LIVE_ROOT, type LiveFixture } from "./env";

export function loadLiveFixture(): LiveFixture {
  return JSON.parse(readFileSync(LIVE_FIXTURE_FILE, "utf8")) as LiveFixture;
}

export function currentTotp(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replaceAll("=", "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("The TOTP secret contains an invalid base32 character.");
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  const counter = Math.floor(now / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counterBytes).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function runLiveFixtureScript(args: readonly string[] = []): string {
  const command = [
    "pnpm",
    "--filter",
    "@roamlog/api",
    "exec",
    "tsx",
    "../../tooling/scripts/e2e-auth-fixture.ts",
    ...args,
  ].join(" ");

  return execFileSync(
    process.platform === "win32" ? "cmd.exe" : "/bin/sh",
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
    {
      cwd: LIVE_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ROAMLOG_LIVE_FIXTURE_FILE: LIVE_FIXTURE_FILE,
      },
      stdio: "pipe",
    },
  );
}

export { LIVE_ADMIN_URL, LIVE_FIXTURE_FILE, LIVE_ROOT, type LiveFixture };
