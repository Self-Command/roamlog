import http from "k6/http";
import { check } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = __ENV.API_BASE_URL ?? "http://127.0.0.1:4100";
const SESSION_COOKIE = __ENV.ROAMLOG_SESSION_COOKIE ?? "";
const WORKSPACE_ID = __ENV.ROAMLOG_WORKSPACE_ID ?? "";
const PASSWORD_SHARE_TOKEN = __ENV.ROAMLOG_PASSWORD_SHARE_TOKEN ?? "";
const ORIGIN = __ENV.ROAMLOG_WEB_ORIGIN ?? "http://127.0.0.1:3100";

const authRateLimited = new Rate("auth_rate_limited");
const shareRateLimited = new Rate("share_rate_limited");
const sharePasswordRateLimited = new Rate("share_password_rate_limited");
const uploadRateLimited = new Rate("upload_rate_limited");

http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 299 }, { min: 301, max: 399 }, { min: 400, max: 499 }),
);

export const options = {
  scenarios: {
    auth_bruteforce: {
      executor: "per-vu-iterations",
      exec: "authBruteforce",
      vus: 1,
      iterations: 1,
      tags: { gate: "auth-rate-limit" },
    },
    share_enumeration: {
      executor: "per-vu-iterations",
      exec: "shareEnumeration",
      vus: 1,
      iterations: 1,
      tags: { gate: "share-rate-limit" },
    },
    upload_presign_burst: {
      executor: "per-vu-iterations",
      exec: "uploadPresignBurst",
      vus: 1,
      iterations: 1,
      tags: { gate: "upload-rate-limit" },
    },
    share_password_abuse: {
      executor: "per-vu-iterations",
      exec: "passwordAbuse",
      vus: 1,
      iterations: 1,
      tags: { gate: "share-password-rate-limit" },
    },
  },
  thresholds: {
    auth_rate_limited: ["rate>0"],
    share_rate_limited: ["rate>0"],
    share_password_rate_limited: ["rate>0"],
    upload_rate_limited: ["rate>0"],
  },
};

function authHeaders(contentType, clientIp) {
  return {
    cookie: SESSION_COOKIE,
    origin: ORIGIN,
    "x-forwarded-for": clientIp,
    ...(contentType ? { "content-type": contentType } : {}),
  };
}

export function authBruteforce() {
  let limited = false;
  for (let index = 0; index < 15; index += 1) {
    const response = http.post(
      `${BASE_URL}/v1/auth/sign-in/email`,
      JSON.stringify({
        email: `k6-rate-limit-${index}@roamlog.test`,
        password: "Definitely-Wrong-Aa1!",
      }),
      {
        headers: authHeaders("application/json", "203.0.113.10"),
        tags: { endpoint: "auth-signin" },
      },
    );
    check(response, {
      "auth attempt is 401 or 429": (result) => result.status === 401 || result.status === 429,
    });
    limited = limited || response.status === 429;
  }
  authRateLimited.add(limited);
}

export function shareEnumeration() {
  let limited = false;
  for (let index = 0; index < 100; index += 1) {
    const token = `${index.toString(16).padStart(3, "0")}${"c".repeat(40)}`;
    const response = http.get(`${BASE_URL}/v1/public/trips/${token}`, {
      headers: { "x-forwarded-for": "203.0.113.11" },
      tags: { endpoint: "public-share-enumeration" },
    });
    check(response, {
      "random share token is 404 or 429": (result) =>
        result.status === 404 || result.status === 429,
    });
    limited = limited || response.status === 429;
  }
  shareRateLimited.add(limited);
}

export function uploadPresignBurst() {
  if (!SESSION_COOKIE || !WORKSPACE_ID) {
    throw new Error("ROAMLOG_SESSION_COOKIE and ROAMLOG_WORKSPACE_ID are required");
  }
  let limited = false;
  for (let index = 0; index < 25; index += 1) {
    const response = http.post(
      `${BASE_URL}/v1/workspaces/${WORKSPACE_ID}/media/presign`,
      JSON.stringify({
        fileName: `k6-upload-${index}.png`,
        mimeType: "image/png",
        size: 1024,
      }),
      {
        headers: authHeaders("application/json", "203.0.113.12"),
        tags: { endpoint: "media-presign" },
      },
    );
    check(response, {
      "presign is 201 or 429": (result) => result.status === 201 || result.status === 429,
    });
    limited = limited || response.status === 429;
  }
  uploadRateLimited.add(limited);
}

export function passwordAbuse() {
  if (!PASSWORD_SHARE_TOKEN) {
    throw new Error("ROAMLOG_PASSWORD_SHARE_TOKEN is required");
  }
  let limited = false;
  for (let index = 0; index < 25; index += 1) {
    const response = http.get(
      `${BASE_URL}/v1/public/trips/${PASSWORD_SHARE_TOKEN}?password=wrong-${index}`,
      {
        headers: { "x-forwarded-for": "203.0.113.13" },
        tags: { endpoint: "share-password" },
      },
    );
    check(response, {
      "password attempt is 401 or 429": (result) => result.status === 401 || result.status === 429,
    });
    limited = limited || response.status === 429;
  }
  sharePasswordRateLimited.add(limited);
}
