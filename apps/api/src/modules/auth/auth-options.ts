import type { AppConfigService } from "../../config/app-config.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { EmailDeliveryService } from "./email-delivery.service.js";
import { generateUuidV7 } from "./uuid.js";

export interface AuthOptionsDependencies {
  config: AppConfigService;
  prisma: PrismaService;
  email: EmailDeliveryService;
  prismaAdapter: (client: unknown, options: { provider: "postgresql" }) => unknown;
  twoFactor: (options: { issuer: string; skipVerificationOnEnable: boolean }) => unknown;
}

export function buildAuthOptions(dependencies: AuthOptionsDependencies): Record<string, unknown> {
  const { config, prisma, email, prismaAdapter, twoFactor } = dependencies;
  const secureCookies = config.isProduction || config.apiUrl.startsWith("https://");
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};

  if (config.googleClientId && config.googleClientSecret) {
    socialProviders.google = {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    };
  }
  if (config.githubClientId && config.githubClientSecret) {
    socialProviders.github = {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
    };
  }

  return {
    appName: "Roamlog",
    baseURL: config.betterAuthUrl,
    basePath: "/v1/auth",
    secret: config.betterAuthSecret,
    trustedOrigins: [
      ...new Set([config.appUrl, config.adminUrl, config.apiUrl, ...config.corsOrigins]),
    ],
    database: prismaAdapter(prisma.client, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async (data: {
        user: { id: string; email: string; name: string };
        url: string;
      }) => {
        await email.sendPasswordResetEmail(data.user, data.url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 3_600,
      sendVerificationEmail: async (data: {
        user: { id: string; email: string; name: string };
        url: string;
      }) => {
        await email.sendVerificationEmail(data.user, data.url);
      },
    },
    socialProviders,
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    account: {
      encryptOAuthTokens: true,
    },
    plugins: [
      twoFactor({
        issuer: "Roamlog",
        skipVerificationOnEnable: false,
      }),
    ],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
    },
    telemetry: {
      enabled: false,
    },
    logger: {
      disabled: true,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const user = await prisma.client.user.findUnique({
              where: { id: session.userId },
              select: {
                status: true,
                deletedAt: true,
                emailVerified: true,
              },
            });
            return Boolean(
              user && user.status === "active" && user.deletedAt === null && user.emailVerified,
            );
          },
        },
      },
    },
    advanced: {
      useSecureCookies: secureCookies,
      cookiePrefix: "roamlog",
      crossSubDomainCookies: {
        enabled: Boolean(config.sessionCookieDomain),
        ...(config.sessionCookieDomain ? { domain: config.sessionCookieDomain } : {}),
      },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: "/",
        ...(config.sessionCookieDomain ? { domain: config.sessionCookieDomain } : {}),
      },
      database: {
        generateId: () => generateUuidV7(),
        validateSchema: true,
      },
    },
  };
}
