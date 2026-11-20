const API = process.env.API_BASE ?? "http://127.0.0.1:4100";
const ORIGIN = "http://localhost:3000";
const CREW = "019b7946-1c12-72e5-b2f5-ba152dee90d6";
const OWNER_WS = "01a1f7a6-a01e-748b-ae6b-930248ec02a6";

const signIn = await fetch(`${API}/v1/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ email: "verify@roamlog.test", password: "Roamlog-Verify-Aa1!" }),
});
console.log("sign-in:", signIn.status);
const cookies = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!cookies) {
  console.log("NO COOKIES:", (await signIn.text()).slice(0, 500));
  process.exit(1);
}

const targets = [
  `/v1/workspaces/${CREW}/members`,
  `/v1/workspaces/${CREW}/members?limit=24`,
  `/v1/workspaces/${OWNER_WS}/members`,
];

for (const path of targets) {
  const response = await fetch(API + path, {
    headers: { cookie: cookies, origin: ORIGIN, accept: "application/json" },
  });
  const text = await response.text();
  let summary = text.slice(0, 400);
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json.items)) {
      summary = JSON.stringify({
        items: json.items.length,
        hasMore: json.hasMore,
        members: json.items.map((m) => ({
          id: m.id,
          role: m.role,
          status: m.status,
          email: m.user.email,
          name: m.user.name,
          image: m.user.image,
        })),
      });
    } else {
      summary = JSON.stringify(json);
    }
  } catch {
    /* keep raw */
  }
  console.log(`\nGET ${path}\n  -> ${response.status} ${response.headers.get("content-type")}`);
  console.log("  " + summary);
}

const me = await fetch(`${API}/v1/me`, { headers: { cookie: cookies, origin: ORIGIN } });
console.log("\nGET /v1/me ->", me.status);