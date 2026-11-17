import { resolve } from "node:path";

export const STAGING_ROOT = resolve(process.cwd());
export const STAGING_WEB_URL = "http://127.0.0.1:3100";
export const STAGING_ADMIN_URL = "http://127.0.0.1:3101";
export const STAGING_API_URL = "http://127.0.0.1:4100";
export const STAGING_REDIS_URL = process.env.ROAMLOG_STAGING_REDIS_URL ?? "redis://127.0.0.1:6379";
export const STAGING_REDIS_PREFIX =
  process.env.ROAMLOG_STAGING_REDIS_PREFIX ?? "roamlog-staging-release";
export const STAGING_DATABASE_SCHEMA = "staging_release_gate";
export const STAGING_DATABASE_URL =
  process.env.ROAMLOG_STAGING_DATABASE_URL ??
  `postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=${STAGING_DATABASE_SCHEMA}`;
export const STAGING_AUTH_SECRET =
  process.env.ROAMLOG_STAGING_AUTH_SECRET ??
  "roamlog-staging-release-gate-secret-at-least-32-bytes";
export const STAGING_FIXTURE_FILE =
  process.env.ROAMLOG_STAGING_FIXTURE_FILE ??
  resolve(STAGING_ROOT, ".e2e-live/staging-fixture.json");
export const STAGING_S3_ENDPOINT =
  process.env.ROAMLOG_STAGING_S3_ENDPOINT ?? "http://127.0.0.1:9000";
export const STAGING_S3_BUCKET = process.env.ROAMLOG_STAGING_S3_BUCKET ?? "roamlog-test";
export const STAGING_S3_ACCESS_KEY = process.env.ROAMLOG_STAGING_S3_ACCESS_KEY ?? "roamlog";
export const STAGING_S3_SECRET_KEY =
  process.env.ROAMLOG_STAGING_S3_SECRET_KEY ?? "roamlog-local-secret";
export const STAGING_SMTP_HOST = process.env.ROAMLOG_STAGING_SMTP_HOST ?? "127.0.0.1";
export const STAGING_SMTP_PORT = process.env.ROAMLOG_STAGING_SMTP_PORT ?? "1025";
export const STAGING_EVIDENCE_ROOT = "test-results/staging-release";
export const STAGING_SHARE_PASSWORD = "Roamlog-Staging-Share-Aa1!";
export const STAGING_ORIGIN = STAGING_WEB_URL;

export interface StagingShare {
  id: string;
  token: string;
  url: string;
  expiresAt: string | null;
  hasPassword: boolean;
}

export interface StagingFixture {
  runId: string;
  generatedAt: string;
  web: {
    id: string;
    email: string;
    name: string;
    password: string;
    sessionCookie: string;
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
  admin: {
    id: string;
    email: string;
    name: string;
    password: string;
    totpSecret: string;
    platformRole: "admin" | "super_admin";
  };
  pendingAdmin: {
    id: string;
    email: string;
    name: string;
    password: string;
    sessionCookie: string;
  };
  target: {
    id: string;
    email: string;
    name: string;
    password: string;
  };
  outsider: {
    id: string;
    email: string;
    name: string;
    password: string;
    workspaceId: string;
    tripId: string;
  };
  journey: {
    tripId: string;
    tripTitle: string;
    entryId: string;
    entryTitle: string;
  };
  shares: {
    public: StagingShare;
    password: StagingShare;
    expired: StagingShare;
    revoked: StagingShare;
  };
  adminOperations?: {
    flagKey: string;
    emailLogId: string;
    emailTo: string;
    failedJobId: string;
    queueName: "email";
    contentTripId: string;
    contentTitle: string;
  };
}
