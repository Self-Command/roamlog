/**
 * DESTINATIONS_UPGRADE end-to-end check against a real API process.
 *
 * Requires the API to be running (see `destinations-e2e.sh`) and a seeded
 * owner account. It exercises the documented contract:
 *   1. POST /trips with two structured destinations -> 201
 *   2. GET  /trips/:id -> ordered destinationsV2 + derived names
 *   3. PATCH to one destination -> old rows soft-deleted, GET shows one
 *   4. POST a legacy trip with only `destinations: string[]` -> 201 and readable
 *
 * Test data only; no real personal information is printed.
 */
const API = process.env.DEST_E2E_API_URL ?? "http://127.0.0.1:4270";
const EMAIL = process.env.DEST_E2E_EMAIL ?? "dest-e2e@roamlog.test";
const PASSWORD = process.env.DEST_E2E_PASSWORD ?? "Roamlog-Dest-Aa1!";
const ORIGIN = "http://localhost:3000";

let cookie = "";
let failures = 0;

function show(label, value) {
  console.log(`\n--- ${label} ---`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

async function request(method, path, body) {
  const headers = { origin: ORIGIN, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    // Never let a half-started server hold the check open forever.
    signal: AbortSignal.timeout(30_000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
  }
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${API}/v1/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`API did not become healthy at ${API}`);
}

const KYOTO = {
  name: "京都",
  provider: "geoapify",
  providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
  address: "京都市, 京都府, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  timeZone: "Asia/Tokyo",
  bbox: [135.6, 34.85, 135.93, 35.17],
};
const OSAKA = {
  name: "大阪",
  provider: "photon",
  providerPlaceId: "P:1234",
  address: "大阪市, 大阪府, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 34.6937,
  lng: 135.5023,
  timeZone: "Asia/Tokyo",
  bbox: [135.13, 34.53, 135.68, 34.87],
};

await waitForHealth();

const signIn = await request("POST", "/v1/auth/sign-in/email", {
  email: EMAIL,
  password: PASSWORD,
  rememberMe: true,
});
show("POST /v1/auth/sign-in/email", {
  status: signIn.status,
  user: signIn.json?.user ? { id: signIn.json.user.id, email: signIn.json.user.email } : signIn.json,
});
check("sign-in returns 200 with a session cookie", signIn.status === 200 && cookie.length > 0, {
  status: signIn.status,
});

const workspaces = await request("GET", "/v1/workspaces");
show("GET /v1/workspaces", {
  status: workspaces.status,
  items: Array.isArray(workspaces.json)
    ? workspaces.json.map((workspace) => ({ id: workspace.id, slug: workspace.slug }))
    : workspaces.json,
});
const workspaceId = Array.isArray(workspaces.json) ? workspaces.json[0]?.id : undefined;
check("the seeded workspace is visible", workspaces.status === 200 && Boolean(workspaceId));

// 1) create with two structured destinations
const created = await request("POST", `/v1/workspaces/${workspaceId}/trips`, {
  title: "关西慢行",
  summary: "目的地结构化的端到端验收。",
  status: "planning",
  startDate: "2026-12-01",
  endDate: "2026-12-08",
  origin: "上海",
  timeZone: "Asia/Tokyo",
  destinationsV2: [KYOTO, OSAKA],
});
const tripId = created.json?.id;
show("POST /v1/workspaces/:workspaceId/trips", { status: created.status, body: created.json });
check("create with destinationsV2 returns 201", created.status === 201, created.status);
check(
  "create response carries both destinations in order",
  Array.isArray(created.json?.destinationsV2) &&
    created.json.destinationsV2.map((destination) => destination.name).join(",") === "京都,大阪" &&
    created.json.destinationsV2[0].address === KYOTO.address &&
    created.json.destinationsV2[0].lat === KYOTO.lat &&
    created.json.destinationsV2[1].timeZone === "Asia/Tokyo",
  created.json?.destinationsV2,
);
check(
  "create response also exposes the deprecated names array",
  JSON.stringify(created.json?.destinations) === JSON.stringify(["京都", "大阪"]),
  created.json?.destinations,
);

// 2) read back
const readBack = await request("GET", `/v1/trips/${tripId}`);
show("GET /v1/trips/:tripId", { status: readBack.status, body: readBack.json });
check("read-back returns 200", readBack.status === 200, readBack.status);
check(
  "read-back keeps order, address, coordinates, bbox and timezone",
  readBack.json?.destinationsV2?.length === 2 &&
    readBack.json.destinationsV2.map((destination) => destination.order).join(",") === "0,1" &&
    readBack.json.destinationsV2[1].provider === "photon" &&
    readBack.json.destinationsV2[1].lng === OSAKA.lng &&
    JSON.stringify(readBack.json.destinationsV2[0].bbox) === JSON.stringify(KYOTO.bbox),
  readBack.json?.destinationsV2,
);

// 3) replace three with two -> then one, proving soft deletion
const three = await request("PATCH", `/v1/trips/${tripId}`, {
  version: readBack.json.version,
  destinationsV2: [KYOTO, OSAKA, { name: "奈良", provider: "local" }],
});
show("PATCH /v1/trips/:tripId (3 destinations)", {
  status: three.status,
  destinationsV2: three.json?.destinationsV2?.map((destination) => destination.name),
  destinations: three.json?.destinations,
  version: three.json?.version,
});
check(
  "replacing the group keeps three active rows",
  three.status === 200 && three.json?.destinationsV2?.length === 3,
  three.json?.destinationsV2,
);

const one = await request("PATCH", `/v1/trips/${tripId}`, {
  version: three.json.version,
  destinationsV2: [OSAKA],
});
show("PATCH /v1/trips/:tripId (replace with 1)", {
  status: one.status,
  destinationsV2: one.json?.destinationsV2?.map((destination) => destination.name),
  destinations: one.json?.destinations,
  version: one.json?.version,
});
check("replacement leaves exactly one active destination", one.json?.destinationsV2?.length === 1);
check(
  "the remaining destination keeps its place metadata",
  one.json?.destinationsV2?.[0]?.name === "大阪" &&
    one.json?.destinationsV2?.[0]?.address === OSAKA.address &&
    one.json?.destinationsV2?.[0]?.order === 0,
  one.json?.destinationsV2,
);

const afterReplace = await request("GET", `/v1/trips/${tripId}`);
show("GET after replacement", {
  status: afterReplace.status,
  destinationsV2: afterReplace.json?.destinationsV2?.map((destination) => ({
    name: destination.name,
    order: destination.order,
  })),
  destinations: afterReplace.json?.destinations,
});
check(
  "GET after replacement shows only the new row",
  afterReplace.json?.destinationsV2?.length === 1 &&
    afterReplace.json?.destinationsV2?.[0]?.name === "大阪" &&
    JSON.stringify(afterReplace.json?.destinations) === JSON.stringify(["大阪"]),
  afterReplace.json?.destinationsV2,
);

// 4) legacy create path must still work
const legacy = await request("POST", `/v1/workspaces/${workspaceId}/trips`, {
  title: "东京老客户端",
  startDate: "2027-01-01",
  endDate: "2027-01-03",
  destinations: ["东京"],
});
show("POST legacy trip (destinations only)", { status: legacy.status, body: legacy.json });
check(
  "legacy create returns 201 with the names array",
  legacy.status === 201 && JSON.stringify(legacy.json?.destinations) === JSON.stringify(["东京"]),
  { status: legacy.status, destinations: legacy.json?.destinations },
);
check(
  "legacy create returns an empty structured group instead of inventing rows",
  Array.isArray(legacy.json?.destinationsV2) && legacy.json.destinationsV2.length === 0,
  legacy.json?.destinationsV2,
);

const legacyRead = await request("GET", `/v1/trips/${legacy.json.id}`);
show("GET legacy trip", {
  status: legacyRead.status,
  destinations: legacyRead.json?.destinations,
  destinationsV2: legacyRead.json?.destinationsV2,
});
check(
  "legacy trip remains readable after the upgrade",
  legacyRead.status === 200 &&
    JSON.stringify(legacyRead.json?.destinations) === JSON.stringify(["东京"]) &&
    Array.isArray(legacyRead.json?.destinationsV2),
  legacyRead.json?.destinations,
);

console.log(`\n${failures === 0 ? "ALL E2E CHECKS PASSED" : `${failures} E2E CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);