import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const apiOrigin = process.env.BOOTSTRAP_API_ORIGIN ?? "https://we.spacedo.org";
const email = process.env.BOOTSTRAP_EMAIL;
const verifyUrl = process.env.BOOTSTRAP_VERIFY_URL;
const resetUrl = process.env.BOOTSTRAP_RESET_URL;
const outputFile =
  process.env.BOOTSTRAP_CREDENTIALS_FILE ?? "/opt/roamlog/config/admin-credentials.json";

if (!email || !verifyUrl || !resetUrl) {
  throw new Error("BOOTSTRAP_EMAIL, BOOTSTRAP_VERIFY_URL, and BOOTSTRAP_RESET_URL are required.");
}

const password = `${randomBytes(18).toString("base64url")}Aa1!`;

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replaceAll("=", "").toUpperCase();
  const bytes = [];
  let bits = 0;
  let buffer = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("The TOTP secret is not valid base32.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest.at(-1) & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

function cookieHeader(setCookies) {
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function api(path, options = {}) {
  const response = await fetch(`${apiOrigin}/v1/auth${path}`, {
    ...options,
    headers: {
      Origin: apiOrigin,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

const verifyResponse = await fetch(verifyUrl, {
  redirect: "manual",
  headers: { Origin: apiOrigin },
});
if (![200, 302, 303, 307, 308].includes(verifyResponse.status)) {
  throw new Error(`Email verification failed with HTTP ${verifyResponse.status}.`);
}

const resetCallback = await fetch(resetUrl, {
  redirect: "manual",
  headers: { Origin: apiOrigin },
});
const resetLocation = resetCallback.headers.get("location");
if (!resetLocation) throw new Error("Password reset callback did not return a redirect.");
const resetToken = new URL(resetLocation).searchParams.get("token");
if (!resetToken) throw new Error("Password reset redirect did not contain a token.");

const reset = await api("/reset-password", {
  method: "POST",
  body: JSON.stringify({ token: resetToken, newPassword: password }),
});
if (reset.response.status !== 200) {
  throw new Error(`Password reset failed with HTTP ${reset.response.status}.`);
}

const signIn = await api("/sign-in/email", {
  method: "POST",
  body: JSON.stringify({ email, password, rememberMe: true }),
});
if (signIn.response.status !== 200) {
  throw new Error(`Sign-in failed with HTTP ${signIn.response.status}.`);
}
const sessionCookie = cookieHeader(signIn.response.headers.getSetCookie?.() ?? []);
if (!sessionCookie) throw new Error("Sign-in did not return a session cookie.");

const enable = await api("/two-factor/enable", {
  method: "POST",
  headers: { Cookie: sessionCookie },
  body: JSON.stringify({ password, method: "totp" }),
});
if (enable.response.status !== 200 || typeof enable.json.totpURI !== "string") {
  throw new Error(`2FA enrollment failed with HTTP ${enable.response.status}.`);
}
const totpSecret = new URL(enable.json.totpURI).searchParams.get("secret");
if (!totpSecret) throw new Error("TOTP URI did not contain a secret.");

const verification = await api("/two-factor/verify-totp", {
  method: "POST",
  headers: { Cookie: sessionCookie },
  body: JSON.stringify({ code: currentTotp(totpSecret) }),
});
if (verification.response.status !== 200) {
  throw new Error(`TOTP verification failed with HTTP ${verification.response.status}.`);
}

writeFileSync(
  outputFile,
  JSON.stringify(
    {
      email,
      password,
      totpSecret,
      backupCodes: enable.json.backupCodes ?? [],
      createdAt: new Date().toISOString(),
      apiOrigin,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

console.log(JSON.stringify({ status: "ready", outputFile, email }));
