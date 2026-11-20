const A = "http://127.0.0.1:4000";
const O = "http://localhost:3000";

const s = await fetch(A + "/v1/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: O },
  body: JSON.stringify({ email: "b1b-admin@roamlog.local", password: "Roamlog-B1b-Aa1!" }),
});
console.log("signin", s.status);
const c = s.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
if (s.status !== 200) {
  console.log(await s.text());
  process.exit(1);
}

const targets = process.argv.slice(2);
for (const t of targets) {
  const r = await fetch(A + t, { headers: { cookie: c, origin: O } });
  const body = await r.text();
  console.log("\n===", t, "->", r.status, r.headers.get("content-type"));
  console.log(body.slice(0, 2500));
}