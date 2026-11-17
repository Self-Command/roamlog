import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export interface CreatePrismaClientOptions {
  connectionString?: string;
  adapter?: PrismaPg;
  client?: PrismaClient;
}

function resolveConnectionString(connectionString?: string): string {
  const value = connectionString ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "DATABASE_URL is required to create the Roamlog Prisma client",
    );
  }
  return value;
}

export function createPrismaClient(
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  if (options.client) {
    return options.client;
  }

  const adapter =
    options.adapter ??
    new PrismaPg({
      connectionString: resolveConnectionString(options.connectionString),
      max: 10,
    });

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
