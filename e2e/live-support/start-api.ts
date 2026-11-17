import "reflect-metadata";

import { startRedisStub } from "./redis-stub";

async function main(): Promise<void> {
  await startRedisStub();
  await import("../../apps/api/src/main.js");
}

void main();
