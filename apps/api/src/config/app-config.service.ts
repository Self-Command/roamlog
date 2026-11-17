import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Environment } from "./environment.js";
import type { StorageSettings } from "./storage-settings.js";

@Injectable()
export class AppConfigService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private required<T>(key: keyof Environment): T {
    const value = this.config.get<T>(key);
    if (value === undefined) {
      throw new Error(`Validated environment value is missing: ${key}`);
    }
    return value;
  }

  get nodeEnv(): Environment["NODE_ENV"] {
    return this.required("NODE_ENV");
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get logLevel(): Environment["LOG_LEVEL"] {
    return this.required("LOG_LEVEL");
  }

  get apiPort(): number {
    return this.required("API_PORT");
  }

  get appUrl(): string {
    return this.required("APP_URL");
  }

  get adminUrl(): string {
    return this.required("ADMIN_URL");
  }

  get apiUrl(): string {
    return this.required("API_URL");
  }

  get corsOrigins(): readonly string[] {
    const value = this.required<string[] | string>("CORS_ORIGINS");
    if (Array.isArray(value)) {
      return value;
    }
    return value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get databaseUrl(): string {
    return this.required("DATABASE_URL");
  }

  get redisUrl(): string {
    return this.required("REDIS_URL");
  }

  get redisPrefix(): string {
    return this.required("REDIS_PREFIX");
  }

  get betterAuthSecret(): string {
    return this.required("BETTER_AUTH_SECRET");
  }

  get sessionCookieDomain(): string | undefined {
    return this.config.get<string>("SESSION_COOKIE_DOMAIN");
  }

  get betterAuthUrl(): string {
    return this.config.get<string>("BETTER_AUTH_URL") ?? this.apiUrl;
  }

  get googleClientId(): string | undefined {
    return this.config.get<string>("GOOGLE_CLIENT_ID");
  }

  get googleClientSecret(): string | undefined {
    return this.config.get<string>("GOOGLE_CLIENT_SECRET");
  }

  get githubClientId(): string | undefined {
    return this.config.get<string>("GITHUB_CLIENT_ID");
  }

  get githubClientSecret(): string | undefined {
    return this.config.get<string>("GITHUB_CLIENT_SECRET");
  }

  get trustProxy(): boolean {
    return this.required("TRUST_PROXY");
  }

  get sentryDsn(): string | undefined {
    return this.config.get<string>("SENTRY_DSN");
  }

  get sentryTracesSampleRate(): number {
    return this.required("SENTRY_TRACES_SAMPLE_RATE");
  }

  get smtpHost(): string | undefined {
    return this.config.get<string>("SMTP_HOST");
  }

  get smtpPort(): number {
    return this.required("SMTP_PORT");
  }

  get smtpUser(): string | undefined {
    return this.config.get<string>("SMTP_USER");
  }

  get smtpPassword(): string | undefined {
    return this.config.get<string>("SMTP_PASSWORD");
  }

  get resendApiKey(): string | undefined {
    return this.config.get<string>("RESEND_API_KEY");
  }

  get emailFrom(): string {
    return this.required("EMAIL_FROM");
  }

  get signedUrlTtlSeconds(): number {
    return this.required("EXPORT_SIGNED_URL_TTL");
  }

  get bootstrapSuperAdminEmail(): string | undefined {
    return this.config.get<string>("BOOTSTRAP_SUPER_ADMIN_EMAIL");
  }

  get storageSettings(): StorageSettings {
    return {
      endpoint: this.required("S3_ENDPOINT"),
      bucket: this.required("S3_BUCKET"),
      accessKey: this.required("S3_ACCESS_KEY"),
      secretKey: this.required("S3_SECRET_KEY"),
      region: this.required("S3_REGION"),
      forcePathStyle: this.required("S3_FORCE_PATH_STYLE"),
      signedUrlTtlSeconds: this.signedUrlTtlSeconds,
    };
  }
}
