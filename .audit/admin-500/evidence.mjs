const A = process.env.API_BASE ?? "http://127.0.0.1:4000";
const O = "http://localhost:3000";

const s = await fetch(A + "/v1/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: O },
  body: JSON.stringify({ email: "b1b-admin@roamlog.local", password: "Roamlog-B1b-Aa1!" }),
});
console.log("signin", A, "->", s.status);
const c = s.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
if (s.status !== 200) {
  console.log(await s.text());
  process.exit(1);
}

const hits = [
  "/v1/admin/system",
  "/v1/admin/audit?limit=5",
  "/v1/admin/audit/export",
  "/v1/admin/trips?workspaceId=019b7946-1c12-72e5-b2f5-ba152dee90d6",
  "/v1/admin/trips",
];

for (const t of hits) {
  const r = await fetch(A + t, { headers: { cookie: c, origin: O } });
  const ct = r.headers.get("content-type") ?? "";
  const body = await r.text();
  console.log(`\n=== ${t} -> ${r.status} (${ct})`);
  if (ct.includes("json")) {
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      console.log(body.slice(0, 800));
      continue;
    }
    if (Array.isArray(json.items)) {
      console.log("items.length =", json.items.length, "hasMore =", json.hasMore);
      for (const item of json.items.slice(0, 3)) {
        console.log("  ", JSON.stringify(item));
      }
    } else {
      console.log(JSON.stringify(json).slice(0, 800));
    }
  } else {
    const lines = body.split(/\r?\n/).slice(0, 3);
    console.log("bytes =", body.length, "| first lines:");
    for (const line of lines) console.log("  ", line.slice(0, 400));
  }
}