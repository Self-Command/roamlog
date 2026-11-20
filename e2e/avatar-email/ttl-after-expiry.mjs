/**
 * Proves the avatar survives its own signed URL expiring.
 *
 * Run against an API started with an accelerated media TTL:
 *
 *   MEDIA_SIGNED_URL_TTL_SECONDS=60 API_PORT=4373 ... pnpm --filter @roamlog/api exec tsx src/main.ts
 *   node e2e/avatar-email/ttl-after-expiry.mjs <email> <password>
 *
 * The stored row holds a media id, so the URL the API handed out first is
 * allowed to expire (403) and the next `GET /v1/me` re-signs a URL that loads —
 * which is exactly what a page refresh after 15 minutes does in production.
 */
const API_URL = process.env.ROAMLOG_ACCEPTANCE_API_URL ?? "http://127.0.0.1:4373";
const [, , emailArg, passwordArg] = process.argv;
const email = emailArg ?? "avatar-ttl-probe@roamlog.test";
const password = passwordArg ?? "Roamlog-Avatar-Aa1!";

function cookieFrom(response) {
  const all = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  return all.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

async function signIn() {
  const response = await fetch(`${API_URL}/v1/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3200" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  const cookie = cookieFrom(response);
  if (!cookie) throw new Error("sign-in returned no session cookie");
  return cookie;
}

async function me(cookie) {
  const response = await fetch(`${API_URL}/v1/me`, { headers: { cookie, accept: "application/json" } });
  if (!response.ok) throw new Error(`GET /v1/me failed: ${response.status}`);
  return await response.json();
}

async function head(url) {
  const response = await fetch(url, { method: "GET" });
  return response.status;
}

const cookie = await signIn();
const before = await me(cookie);
if (!before.image) throw new Error("account has no avatar — run the avatar spec first");
const firstUrl = before.image;
const firstExpires = new URL(firstUrl).searchParams.get("X-Amz-Expires");

console.log("TTL", firstExpires, "s");
console.log("first URL loads now:", await head(firstUrl));

const waitMs = Number(process.env.TTL_WAIT_MS ?? 65_000);
console.log(`waiting ${Math.round(waitMs / 1000)}s for the first signature to expire…`);
await new Promise((resolve) => setTimeout(resolve, waitMs));

const expiredStatus = await head(firstUrl);
const after = await me(cookie);
const secondStatus = after.image ? await head(after.image) : 0;

const firstSignedAt = new URL(firstUrl).searchParams.get("X-Amz-Date");
const secondSignedAt = after.image ? new URL(after.image).searchParams.get("X-Amz-Date") : null;

console.log("first URL after expiry:", expiredStatus, "(the local S3 stub does not verify SigV4, so this can stay 200)");
console.log("URL changed after expiry:", after.image !== firstUrl);
console.log("re-signed at (X-Amz-Date):", firstSignedAt, "->", secondSignedAt);
console.log("re-signed URL loads:", secondStatus);

if (!(after.image && after.image !== firstUrl && secondStatus === 200 && secondSignedAt !== firstSignedAt)) {
  throw new Error("avatar did not survive its signed URL expiring");
}
console.log("OK: avatar still renders after the signed URL expired");