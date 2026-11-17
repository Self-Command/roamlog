import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";

import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthSessionContext } from "../../common/guards/actor-context.js";
import { buildAuthOptions } from "./auth-options.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

interface BetterAuthEngine {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(options: { headers: Headers }): Promise<unknown>;
  };
}

interface SessionPayload {
  session?: {
    id?: unknown;
    userId?: unknown;
    expiresAt?: unknown;
  };
  user?: {
    id?: unknown;
  };
}

function headersFromNode(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function expiresAt(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private engine: BetterAuthEngine | undefined;
  private initializePromise: Promise<void> | undefined;

  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailDeliveryService) private readonly email: EmailDeliveryService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async initialize(): Promise<void> {
    if (this.engine) {
      return;
    }
    this.initializePromise ??= this.createEngine();
    await this.initializePromise;
  }

  private async createEngine(): Promise<void> {
    try {
      const betterAuthPackage = "better-auth";
      const adapterPackage = "better-auth/adapters/prisma";
      const twoFactorPackage = "better-auth/plugins/two-factor";
      const { betterAuth } = (await import(betterAuthPackage)) as {
        betterAuth: (options: Record<string, unknown>) => BetterAuthEngine;
      };
      const { prismaAdapter } = (await import(adapterPackage)) as {
        prismaAdapter: (client: unknown, options: { provider: "postgresql" }) => unknown;
      };
      const { twoFactor } = (await import(twoFactorPackage)) as {
        twoFactor: (options: { issuer: string; skipVerificationOnEnable: boolean }) => unknown;
      };

      const options = buildAuthOptions({
        config: this.config,
        prisma: this.prisma,
        email: this.email,
        prismaAdapter,
        twoFactor,
      });
      this.engine = betterAuth(options);
    } catch (error) {
      if (this.config.isProduction) {
        throw error;
      }
      this.logger.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "auth.better_auth_unavailable",
      );
    }
  }

  private requireEngine(): BetterAuthEngine {
    if (!this.engine) {
      throw new ServiceUnavailableException({
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable.",
      });
    }
    return this.engine;
  }

  async resolveSession(headers: IncomingHttpHeaders): Promise<AuthSessionContext | null> {
    await this.initialize();
    if (!this.engine) {
      return null;
    }

    const result = (await this.engine.api.getSession({
      headers: headersFromNode(headers),
    })) as SessionPayload | null;
    const userId = result?.user?.id;
    const sessionId = result?.session?.id;
    if (typeof userId !== "string" || typeof sessionId !== "string") {
      return null;
    }

    return {
      sessionId,
      userId,
      expiresAt: expiresAt(result?.session?.expiresAt),
    };
  }

  async handleWebRequest(request: Request): Promise<Response> {
    await this.initialize();
    return this.requireEngine().handler(request);
  }
}
