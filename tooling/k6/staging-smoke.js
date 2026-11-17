import http from "k6/http";
import { check, fail, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL = __ENV.API_BASE_URL ?? "http://127.0.0.1:4100";
const SESSION_COOKIE = __ENV.ROAMLOG_SESSION_COOKIE ?? "";
const WORKSPACE_ID = __ENV.ROAMLOG_WORKSPACE_ID ?? "";
const TRIP_ID = __ENV.ROAMLOG_TRIP_ID ?? "";
const SHARE_TOKEN = __ENV.ROAMLOG_SHARE_TOKEN ?? "";
const AUTH_ORIGIN = __ENV.ROAMLOG_WEB_ORIGIN ?? "http://127.0.0.1:3100";

const unexpectedResponse = new Rate("unexpected_response");
const healthLatency = new Trend("health_latency", true);
const authenticatedLatency = new Trend("authenticated_list_latency", true);
const publicShareLatency = new Trend("public_share_latency", true);

http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 299 }, { min: 301, max: 399 }, { min: 400, max: 499 }),
);

export const options = {
  scenarios: {
    health: {
      executor: "constant-vus",
      exec: "health",
      vus: 4,
      duration: "15s",
      tags: { gate: "health" },
    },
    unauthenticated_admin: {
      executor: "constant-vus",
      exec: "unauthenticatedAdmin",
      vus: 2,
      duration: "15s",
      tags: { gate: "admin-denial" },
    },
    authenticated_reads: {
      executor: "constant-vus",
      exec: "authenticatedReads",
      vus: 4,
      duration: "15s",
      startTime: "1s",
      tags: { gate: "authenticated" },
    },
    public_share: {
      executor: "constant-vus",
      exec: "publicShare",
      vus: 2,
      duration: "15s",
      startTime: "1s",
      tags: { gate: "public-share" },
    },
  },
  thresholds: {
    unexpected_response: ["rate<0.01"],
    "http_req_failed{gate:health}": ["rate<0.01"],
    "http_req_duration{gate:health}": ["p(95)<300"],
    "http_req_duration{gate:authenticated}": ["p(95)<300"],
    "http_req_duration{gate:public-share}": ["p(95)<300"],
    health_latency: ["p(95)<300"],
    authenticated_list_latency: ["p(95)<300"],
    public_share_latency: ["p(95)<300"],
  },
};

function authHeaders(extra = {}) {
  return {
    headers: {
      cookie: SESSION_COOKIE,
      origin: AUTH_ORIGIN,
      ...extra,
    },
  };
}

function distributedClientIp(namespace) {
  const slot = exec.vu.idInTest * 100_000 + __ITER + namespace;
  const second = (Math.floor(slot / 65_536) % 250) + 1;
  const third = (Math.floor(slot / 256) % 250) + 1;
  const fourth = (slot % 250) + 1;
  return `10.${second}.${third}.${fourth}`;
}

export function setup() {
  if (!SHARE_TOKEN && SESSION_COOKIE && TRIP_ID) {
    const response = http.post(
      `${BASE_URL}/v1/trips/${TRIP_ID}/share-links`,
      JSON.stringify({ showBudget: false, allowIndex: false }),
      {
        ...authHeaders({ "content-type": "application/json" }),
        tags: { endpoint: "share-create" },
      },
    );
    if (response.status !== 201) {
      throw new Error(
        `Unable to create k6 share fixture: HTTP ${response.status} ${response.body}`,
      );
    }
    return { shareToken: JSON.parse(response.body).token };
  }
  return { shareToken: SHARE_TOKEN };
}

export function health() {
  const response = http.get(`${BASE_URL}/v1/health`, { tags: { endpoint: "health" } });
  healthLatency.add(response.timings.duration);
  const ok = check(response, {
    "health returns 200": (result) => result.status === 200,
    "health body is ok": (result) => result.json("status") === "ok",
  });
  if (!ok) unexpectedResponse.add(1);
}

export function unauthenticatedAdmin() {
  const response = http.get(`${BASE_URL}/v1/admin/metrics`, {
    tags: { endpoint: "admin-denied" },
  });
  const ok = check(response, {
    "unauthenticated admin returns 401": (result) => result.status === 401,
    "unauthenticated admin does not set a session": (result) => !result.headers["Set-Cookie"],
  });
  if (!ok) unexpectedResponse.add(1);
}

export function authenticatedReads() {
  if (!SESSION_COOKIE || !WORKSPACE_ID) {
    fail("ROAMLOG_SESSION_COOKIE and ROAMLOG_WORKSPACE_ID are required");
  }
  group("workspaces and trips", () => {
    const workspaces = http.get(`${BASE_URL}/v1/me/workspaces`, {
      ...authHeaders(),
      tags: { endpoint: "workspaces" },
    });
    authenticatedLatency.add(workspaces.timings.duration);
    const workspacesOk = check(workspaces, {
      "workspaces returns 200": (result) => result.status === 200,
      "workspaces includes staging workspace": (result) =>
        Array.isArray(result.json()) &&
        result.json().some((workspace) => workspace.id === WORKSPACE_ID),
    });
    if (!workspacesOk) unexpectedResponse.add(1);

    const trips = http.get(`${BASE_URL}/v1/workspaces/${WORKSPACE_ID}/trips?limit=20`, {
      ...authHeaders(),
      tags: { endpoint: "trips" },
    });
    authenticatedLatency.add(trips.timings.duration);
    const tripsOk = check(trips, {
      "trips returns 200": (result) => result.status === 200,
      "trips body has items": (result) => Array.isArray(result.json("items")),
    });
    if (!tripsOk) unexpectedResponse.add(1);
  });
}

export function publicShare(data) {
  const token = data.shareToken;
  if (!token) {
    fail("ROAMLOG_SHARE_TOKEN or authenticated setup data is required");
  }
  const response = http.get(`${BASE_URL}/v1/public/trips/${token}`, {
    headers: {
      "x-forwarded-for": distributedClientIp(1),
    },
    tags: { endpoint: "public-share" },
  });
  publicShareLatency.add(response.timings.duration);
  const ok = check(response, {
    "public share returns 200": (result) => result.status === 200,
    "public share has trip title": (result) => typeof result.json("trip.title") === "string",
    "public share has no email field": (result) => !result.body.includes("@roamlog.test"),
    "public share has no comments": (result) => !result.body.includes("comments"),
  });
  if (!ok) unexpectedResponse.add(1);
}
