import { z } from "zod";

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string().min(1).max(40),
    uptimeSeconds: z.number().int().nonnegative(),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const DependencyHealthSchema = z
  .object({
    status: z.enum(["up", "down"]),
    latencyMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const ReadyResponseSchema = z
  .object({
    // `ok`: every dependency answers. `degraded`: only Redis is down, the API
    // still serves (HTTP 200). `unavailable`: database or object storage down
    // (HTTP 503). The API already answered `unavailable`; it is part of the
    // contract so clients no longer receive an undeclared value.
    status: z.enum(["ok", "degraded", "unavailable"]),
    checks: z
      .object({
        database: DependencyHealthSchema,
        redis: DependencyHealthSchema,
        storage: DependencyHealthSchema,
      })
      .strict(),
  })
  .strict();
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
