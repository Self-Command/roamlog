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

  /**
   * Deployment flavour (`development` | `staging` | `production` | `test`).
   * Independent from NODE_ENV: staging also runs NODE_ENV=production, so
   * production-only mail rules must read APP_ENV.
   */
  get appEnv(): Environment["APP_ENV"] {
    return this.required("APP_ENV");
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

  get rateLimitWindowSeconds(): number {
    return this.required("RATE_LIMIT_WINDOW_SECONDS");
  }

  get authRateLimitMax(): number {
    return this.required("AUTH_RATE_LIMIT_MAX");
  }

  get publicShareRateLimitMax(): number {
    return this.required("PUBLIC_SHARE_RATE_LIMIT_MAX");
  }

  get publicSharePasswordRateLimitMax(): number {
    return this.required("PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX");
  }

  get mediaPresignRateLimitMax(): number {
    return this.required("MEDIA_PRESIGN_RATE_LIMIT_MAX");
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

  get adminTwoFactorEnforced(): boolean {
    return this.config.get<boolean>("ADMIN_2FA_ENFORCED") ?? this.isProduction;
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

  /** Configured mail transport. Production validation forbids `mailpit`. */
  get emailProvider(): Environment["EMAIL_PROVIDER"] {
    return this.required("EMAIL_PROVIDER");
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

  /**
   * Default lifetime of browser-facing media URLs. Separate from
   * `EXPORT_SIGNED_URL_TTL` so downloads and image reads can be tuned apart.
   */
  get mediaSignedUrlTtlSeconds(): number {
    return this.required("MEDIA_SIGNED_URL_TTL_SECONDS");
  }

  /**
   * Browser-reachable origin used to presign media URLs. Always resolved by
   * environment validation (falls back to `S3_ENDPOINT` for local/staging).
   */
  get s3PublicEndpoint(): string {
    return this.required("S3_PUBLIC_ENDPOINT");
  }

  /** Optional unsigned public object base URL. Reserved; nothing reads it yet. */
  get s3PublicBaseUrl(): string | undefined {
    return this.config.get<string>("S3_PUBLIC_BASE_URL");
  }

  get bootstrapSuperAdminEmail(): string | undefined {
    return this.config.get<string>("BOOTSTRAP_SUPER_ADMIN_EMAIL");
  }

  get storageSettings(): StorageSettings {
    const publicBaseUrl = this.s3PublicBaseUrl;
    return {
      endpoint: this.required("S3_ENDPOINT"),
      publicEndpoint: this.s3PublicEndpoint,
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
      bucket: this.required("S3_BUCKET"),
      accessKey: this.required("S3_ACCESS_KEY"),
      secretKey: this.required("S3_SECRET_KEY"),
      region: this.required("S3_REGION"),
      forcePathStyle: this.required("S3_FORCE_PATH_STYLE"),
      signedUrlTtlSeconds: this.signedUrlTtlSeconds,
      mediaSignedUrlTtlSeconds: this.mediaSignedUrlTtlSeconds,
    };
  }
}
