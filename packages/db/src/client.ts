import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

// Re-exported so API modules can use `Prisma.DbNull`/`Prisma.JsonNull` without
// importing the generated (gitignored) client path directly.
export { Prisma } from "./generated/prisma/client.js";

export interface CreatePrismaClientOptions {
  connectionString?: string;
  adapter?: PrismaPg;
  client?: PrismaClient;
}

function resolveConnectionString(connectionString?: string): string {
  const value = connectionString ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is required to create the Roamlog Prisma client");
  }
  return value;
}

function resolveSchema(connectionString: string): string {
  try {
    return new URL(connectionString).searchParams.get("schema")?.trim() || "public";
  } catch {
    return "public";
  }
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  if (options.client) {
    return options.client;
  }

  let adapter = options.adapter;
  if (!adapter) {
    const connectionString = resolveConnectionString(options.connectionString);
    adapter = new PrismaPg(
      {
        connectionString,
        max: 10,
      },
      { schema: resolveSchema(connectionString) },
    );
  }

  return new PrismaClient({ adapter });
}

let lazyClient: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  lazyClient ??= createPrismaClient();
  return lazyClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});
