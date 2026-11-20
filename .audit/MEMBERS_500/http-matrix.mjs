const API = process.env.API_BASE ?? "http://127.0.0.1:4100";
const ORIGIN = "http://localhost:3000";
const CREW = "019b7946-1c12-72e5-b2f5-ba152dee90d6";

const signIn = await fetch(`${API}/v1/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({ email: "verify@roamlog.test", password: "Roamlog-Verify-Aa1!" }),
});
const cookies = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const cases = [
  "",
  "?limit=24",
  "?limit=2",
  "?sort=name:asc",
  "?sort=joinedAt:desc",
  "?role=admin",
  "?role=editor&status=active",
  "?q=verify",
  "?q=%E6%9E%97%E5%A2%A8",
  "?limit=100",
];
for (const query of cases) {
  const path = `/v1/workspaces/${CREW}/members${query}`;
  const response = await fetch(API + path, {
    headers: { cookie: cookies, origin: ORIGIN },
  });
  const body = await response.json().catch(() => ({}));
  console.log(
    `${String(response.status).padEnd(4)} ${path.padEnd(52)} items=${body.items?.length ?? "-"} hasMore=${body.hasMore ?? "-"} code=${body.code ?? "-"}`,
  );
}

// Cross-check: a workspace the other agent reported as healthy keeps working.
const owner = await fetch(API + "/v1/workspaces/01a1f7a6-a01e-748b-ae6b-930248ec02a6/members", {
  headers: { cookie: cookies, origin: ORIGIN },
});
const ownerBody = await owner.json();
console.log(`\nowner workspace: ${owner.status} items=${ownerBody.items?.length}`);