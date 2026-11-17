import type { PrismaService } from "../prisma/prisma.service.js";

export type ContentTransaction = Parameters<
  Parameters<PrismaService["client"]["$transaction"]>[0]
>[0];
