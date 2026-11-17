import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const API_BASE_URL = (__ENV.K6_API_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";
const FALLBACK_WORKSPACE_ID = __ENV.WORKSPACE_ID || "019a7e3a-2b40-7c1d-8a5f-000000000003";
const REQUEST_VUS = Number(__ENV.VUS || 1);
const REQUEST_DURATION = __ENV.DURATION || "20s";

const smokeErrors = new Rate("smoke_errors");

export const options = {
  vus: REQUEST_VUS,
  duration: REQUEST_DURATION,
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    smoke_errors: ["rate<0.01"],
  },
};

const expectedStatuses = http.expectedStatuses(200, 401, 403);
http.setResponseCallback(expectedStatuses);

function requestHeaders() {
  return AUTH_COOKIE
    ? {
        headers: {
          Accept: "application/json",
          Cookie: AUTH_COOKIE,
        },
      }
    : {
        headers: {
          Accept: "application/json",
        },
      };
}

function record(name, response, acceptedStatuses) {
  const passed = check(response, {
    [`${name} status is one of ${acceptedStatuses.join("/")}`]: (result) =>
      acceptedStatuses.includes(result.status),
  });
  smokeErrors.add(!passed, {
    endpoint: name,
    actual_status: String(response.status),
    expected_statuses: acceptedStatuses.join("/"),
  });
  return passed;
}

function resolveWorkspaceId() {
  if (!AUTH_COOKIE) return FALLBACK_WORKSPACE_ID;
  const response = http.get(`${API_BASE_URL}/v1/workspaces`, requestHeaders());
  if (response.status !== 200) return FALLBACK_WORKSPACE_ID;
  try {
    const body = JSON.parse(response.body);
    const items = Array.isArray(body) ? body : (body.items ?? body.workspaces ?? []);
    return items[0]?.id || FALLBACK_WORKSPACE_ID;
  } catch {
    return FALLBACK_WORKSPACE_ID;
  }
}

const workspaceId = resolveWorkspaceId();
const protectedStatuses = AUTH_COOKIE ? [200] : [401, 403];

export default function smoke() {
  const health = http.get(`${API_BASE_URL}/v1/health`, {
    headers: { Accept: "application/json" },
  });
  record("GET /v1/health", health, [200]);

  const adminBoundary = http.get(`${API_BASE_URL}/v1/admin/users`, {
    headers: { Accept: "application/json" },
  });
  record("GET /v1/admin/users (boundary)", adminBoundary, [401, 403]);

  const workspaces = http.get(`${API_BASE_URL}/v1/workspaces`, requestHeaders());
  record("GET /v1/workspaces", workspaces, protectedStatuses);

  const trips = http.get(
    `${API_BASE_URL}/v1/workspaces/${encodeURIComponent(workspaceId)}/trips`,
    requestHeaders(),
  );
  record("GET /v1/workspaces/:workspaceId/trips", trips, protectedStatuses);

  sleep(0.25);
}
