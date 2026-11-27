import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export interface ProviderHealthFailure {
  readonly code: string;
  readonly retryable?: boolean;
}

/**
 * Persists live provider outcomes so the admin console never keeps showing an
 * old "healthy" probe after real traffic starts failing. Health writes are a
 * side effect of the request path: callers decide whether to await them and
 * must never turn a health-write failure into the user's delivery error.
 */
@Injectable()
export class ProviderHealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordSuccess(providerId: string): Promise<void> {
    await this.prisma.client.providerConnection.updateMany({
      where: { id: providerId, deletedAt: null },
      data: {
        healthStatus: "healthy",
        lastCheckedAt: new Date(),
        lastErrorCode: null,
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  }

  async recordFailure(providerId: string, failure: ProviderHealthFailure): Promise<void> {
    const now = Date.now();
    await this.prisma.client.providerConnection.updateMany({
      where: { id: providerId, deletedAt: null },
      data: {
        healthStatus: failure.retryable ? "degraded" : "unhealthy",
        lastCheckedAt: new Date(now),
        lastErrorCode: failure.code.slice(0, 80),
        consecutiveFailures: { increment: 1 },
        cooldownUntil: new Date(now + 30_000),
      },
    });
  }
}
