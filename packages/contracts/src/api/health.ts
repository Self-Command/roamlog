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
    status: z.enum(["ok", "degraded"]),
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
