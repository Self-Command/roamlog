import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterConstructor = vi.hoisted(() => vi.fn());
const prismaClientConstructor = vi.hoisted(() => vi.fn());

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(poolConfig: unknown, options: unknown) {
      adapterConstructor(poolConfig, options);
    }
  },
}));

vi.mock("../generated/prisma/client.js", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      prismaClientConstructor(options);
    }
  },
}));

import { createPrismaClient } from "../client.js";

describe("createPrismaClient", () => {
  beforeEach(() => {
    adapterConstructor.mockClear();
    prismaClientConstructor.mockClear();
  });

  it("passes an explicit PostgreSQL schema to PrismaPg", () => {
    const connectionString =
      "postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=staging_bootstrap_e2e";

    createPrismaClient({ connectionString });

    expect(adapterConstructor).toHaveBeenCalledWith(
      {
        connectionString,
        max: 10,
      },
      { schema: "staging_bootstrap_e2e" },
    );
    expect(prismaClientConstructor).toHaveBeenCalledTimes(1);
  });

  it("defaults to the public schema when the connection string omits schema", () => {
    const connectionString = "postgresql://roamlog:roamlog@localhost:55432/roamlog";

    createPrismaClient({ connectionString });

    expect(adapterConstructor).toHaveBeenCalledWith(
      {
        connectionString,
        max: 10,
      },
      { schema: "public" },
    );
  });
});
