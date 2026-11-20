const A = process.env.API_BASE ?? "http://127.0.0.1:4100";
const O = "http://localhost:3000";
const s = await fetch(A + "/v1/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: O },
  body: JSON.stringify({ email: "b1b-admin@roamlog.local", password: "Roamlog-B1b-Aa1!" }),
});
const c = s.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
console.log("signin", s.status);

const hits = [
  // Exactly what apps/admin/lib/admin-data-source.ts useAdminWorkspaceTrips sends.
  "/v1/admin/trips?workspaceId=019b7946-1c12-72e5-b2f5-ba152dee90d6&limit=5&sort=updatedAt%3Adesc",
  // Exactly what the audit page sends (default sort + limit).
  "/v1/admin/audit?limit=20",
  "/v1/admin/workspaces/019b7946-1c12-72e5-b2f5-ba152dee90d6",
];
for (const t of hits) {
  const r = await fetch(A + t, { headers: { cookie: c, origin: O } });
  const body = await r.text();
  let summary = body.slice(0, 300);
  try {
    const json = JSON.parse(body);
    summary = Array.isArray(json.items)
      ? `items=${json.items.length} hasMore=${json.hasMore} first=${JSON.stringify(json.items[0] ?? null).slice(0, 180)}`
      : JSON.stringify(json).slice(0, 400);
  } catch {}
  console.log(`${t}\n   -> ${r.status} ${summary}`);
}