import type { Prisma } from "../generated/prisma/client.js";

export type SeedTransaction = Prisma.TransactionClient;

export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateTime(value: string): Date {
  return new Date(value);
}

export function nullableDateTime(value: string | null): Date | null {
  return value ? dateTime(value) : null;
}

export function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
