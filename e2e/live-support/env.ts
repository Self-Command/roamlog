import { resolve } from "node:path";

export const LIVE_ROOT = resolve(process.cwd());
export const LIVE_WEB_URL = "http://127.0.0.1:3100";
export const LIVE_ADMIN_URL = "http://127.0.0.1:3101";
export const LIVE_API_URL = "http://127.0.0.1:4100";
export const LIVE_DATABASE_SCHEMA = "wave5_live_e2e";
export const LIVE_DATABASE_URL =
  process.env.ROAMLOG_LIVE_DATABASE_URL ??
  `postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=${LIVE_DATABASE_SCHEMA}`;
export const LIVE_AUTH_SECRET =
  process.env.ROAMLOG_LIVE_AUTH_SECRET ?? "roamlog-wave5-live-e2e-secret-at-least-32-bytes";
export const LIVE_FIXTURE_FILE =
  process.env.ROAMLOG_LIVE_FIXTURE_FILE ?? resolve(LIVE_ROOT, ".e2e-live/fixture.json");

export interface LiveFixture {
  runId: string;
  generatedAt: string;
  web: LiveUserFixture & {
    sessionCookie: string;
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
  admin: LiveUserFixture & {
    totpSecret: string;
  };
  pendingAdmin: LiveUserFixture & {
    sessionCookie: string;
  };
  target: LiveUserFixture;
  outsider: LiveUserFixture & {
    workspaceId: string;
    tripId: string;
  };
}

export interface LiveUserFixture {
  id: string;
  email: string;
  name: string;
  password: string;
}
