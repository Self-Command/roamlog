import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  STAGING_API_URL,
  STAGING_EVIDENCE_ROOT,
  STAGING_ORIGIN,
  STAGING_S3_ENDPOINT,
  type StagingFixture,
} from "./env";
import { loadStagingFixture } from "./fixture";

const EVIDENCE_DIRECTORY = `${STAGING_EVIDENCE_ROOT}/evidence`;
const ALLOWED_ORIGIN = STAGING_ORIGIN;
const DISALLOWED_ORIGIN = "https://evil.example";

function writeEvidence(name: string, value: unknown): void {
  mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
  writeFileSync(`${EVIDENCE_DIRECTORY}/${name}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function signIn(
  request: APIRequestContext,
  email: string,
  password: string,
  origin = ALLOWED_ORIGIN,
): Promise<{ status: number; setCookie: string; body: unknown }> {
  const response = await request.post(`${STAGING_API_URL}/v1/auth/sign-in/email`, {
    headers: { origin },
    data: { email, password, rememberMe: true },
  });
  const headers = await response.headersArray();
  const setCookie = headers
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value)
    .join("\n");
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the raw body for evidence.
  }
  return { status: response.status(), setCookie, body };
}

function authHeaders(fixture: StagingFixture) {
  return { cookie: fixture.web.sessionCookie, origin: STAGING_ORIGIN };
}

function isolatedClientIp(octet: number): string {
  return `203.0.113.${octet}`;
}

function clientHeaders(octet: number, extra: Record<string, string> = {}) {
  return {
    "x-forwarded-for": isolatedClientIp(octet),
    ...extra,
  };
}

test.describe("Staging security headers and browser boundary", () => {
  test("security headers, CORS allowlist, and cookie attributes are present", async ({
    request,
  }) => {
    const fixture = loadStagingFixture();
    const health = await request.get(`${STAGING_API_URL}/v1/health`);
    expect(health.status()).toBe(200);
    const headers = health.headers();

    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(headers["strict-transport-security"]).toBeUndefined();

    const allowed = await request.fetch(`${STAGING_API_URL}/v1/me/workspaces`, {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "content-type",
      },
    });
    expect([200, 204]).toContain(allowed.status());
    expect(allowed.headers()["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers()["access-control-allow-credentials"]).toBe("true");

    const denied = await request.fetch(`${STAGING_API_URL}/v1/me/workspaces`, {
      method: "OPTIONS",
      headers: {
        origin: DISALLOWED_ORIGIN,
        "access-control-request-method": "GET",
      },
    });
    expect(denied.headers()["access-control-allow-origin"]).toBeUndefined();

    const signInResult = await signIn(request, fixture.web.email, fixture.web.password);
    expect(signInResult.status).toBe(200);
    expect(signInResult.setCookie).toContain("HttpOnly");
    expect(signInResult.setCookie).toMatch(/SameSite=Lax/i);
    expect(signInResult.setCookie).toMatch(/Path=\//);

    writeEvidence("http-headers.json", {
      health: Object.fromEntries(Object.entries(headers).sort()),
      corsAllowed: {
        status: allowed.status(),
        headers: allowed.headers(),
      },
      corsDenied: {
        status: denied.status(),
        headers: denied.headers(),
      },
      signIn: {
        status: signInResult.status,
        setCookie: signInResult.setCookie,
      },
    });
  });

  test("Better Auth rejects a disallowed Origin while custom writes do not enforce it", async ({
    request,
  }) => {
    const fixture = loadStagingFixture();
    const authBoundary = await signIn(
      request,
      fixture.web.email,
      fixture.web.password,
      DISALLOWED_ORIGIN,
    );
    expect.soft(authBoundary.status, "Better Auth must reject cross-origin sign-in").toBe(403);

    const customWrite = await request.post(
      `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/trips`,
      {
        headers: { cookie: fixture.web.sessionCookie, origin: DISALLOWED_ORIGIN },
        data: {},
      },
    );
    const body = await customWrite.text();
    writeEvidence("csrf-probe.json", {
      authBoundary: { status: authBoundary.status, body: authBoundary.body },
      customWrite: { status: customWrite.status(), body },
      expectation:
        "Custom authenticated writes should reject a disallowed Origin before validation; SameSite=Lax and CORS remain browser-side mitigations.",
    });
    expect
      .soft(customWrite.status(), "custom write with a disallowed Origin must be rejected")
      .toBe(403);
    expect
      .soft(body, "custom write rejection must expose a stable error code")
      .toContain("CSRF_ORIGIN_REJECTED");
  });

  test("IDOR, share token sampling, password abuse, MIME, size, and SSRF input gates", async ({
    request,
  }) => {
    const fixture = loadStagingFixture();
    const headers = authHeaders(fixture);

    const idorRead = await request.get(`${STAGING_API_URL}/v1/trips/${fixture.outsider.tripId}`, {
      headers,
    });
    expect(idorRead.status()).toBe(404);

    const wrongPassword = await request.get(
      `${STAGING_API_URL}/v1/public/trips/${fixture.shares.password.token}?password=much-wrong-password`,
    );
    expect(wrongPassword.status()).toBe(401);
    expect(await wrongPassword.json()).toMatchObject({ code: "SHARE_PASSWORD_INVALID" });

    const missingPassword = await request.get(
      `${STAGING_API_URL}/v1/public/trips/${fixture.shares.password.token}`,
    );
    expect(missingPassword.status()).toBe(401);
    expect(await missingPassword.json()).toMatchObject({ code: "SHARE_PASSWORD_REQUIRED" });

    const expired = await request.get(
      `${STAGING_API_URL}/v1/public/trips/${fixture.shares.expired.token}`,
    );
    expect(expired.status()).toBe(404);
    const revoked = await request.get(
      `${STAGING_API_URL}/v1/public/trips/${fixture.shares.revoked.token}`,
    );
    expect(revoked.status()).toBe(404);

    const enumerationStatuses = new Map<number, number>();
    for (let index = 0; index < 20; index += 1) {
      const token = `${index.toString(16).padStart(2, "0")}${"a".repeat(41)}`;
      const response = await request.get(`${STAGING_API_URL}/v1/public/trips/${token}`);
      enumerationStatuses.set(
        response.status(),
        (enumerationStatuses.get(response.status()) ?? 0) + 1,
      );
      expect(response.status()).toBe(404);
    }
    expect([...enumerationStatuses.keys()]).toEqual([404]);

    const unsupportedMime = await request.post(
      `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/media/presign`,
      {
        headers,
        data: { fileName: "payload.pdf", mimeType: "application/pdf", size: 1_024 },
      },
    );
    expect(unsupportedMime.status()).toBe(400);

    const oversized = await request.post(
      `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/media/presign`,
      {
        headers,
        data: {
          fileName: "huge.png",
          mimeType: "image/png",
          size: 25 * 1024 * 1024 + 1,
        },
      },
    );
    expect(oversized.status()).toBe(400);

    const ssrfInput = await request.post(
      `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/media/presign`,
      {
        headers,
        data: {
          fileName: "ssrf.png",
          mimeType: "image/png",
          size: 1_024,
          sourceUrl: "http://169.254.169.254/latest/meta-data/",
        },
      },
    );
    expect(ssrfInput.status()).toBe(400);

    const traversal = await request.post(
      `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/media/presign`,
      {
        headers,
        data: {
          fileName: "../../../etc/passwd.png",
          mimeType: "image/png",
          size: 1_024,
        },
      },
    );
    expect([200, 201]).toContain(traversal.status());
    const traversalBody = await traversal.json();
    expect(traversalBody.uploadUrl).not.toContain("..");
    expect(new URL(traversalBody.uploadUrl).origin).toBe(STAGING_S3_ENDPOINT);
    expect(traversalBody.key ?? "").not.toContain("..");

    writeEvidence("share-and-media-gates.json", {
      enumeration: Object.fromEntries(enumerationStatuses),
      password: {
        missing: missingPassword.status(),
        wrong: wrongPassword.status(),
      },
      expired: expired.status(),
      revoked: revoked.status(),
      mimeRejected: unsupportedMime.status(),
      oversizedRejected: oversized.status(),
      ssrfInputRejected: ssrfInput.status(),
      traversalPresignedStatus: traversal.status(),
    });
  });

  test("omitting the optional trip origin returns a canonical value instead of HTTP 500", async ({
    request,
  }) => {
    const fixture = loadStagingFixture();
    const headers = authHeaders(fixture);
    const title = `Optional origin release gate ${fixture.runId}`;
    const created = await request.post(
      `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/trips`,
      {
        headers,
        data: {
          title,
          status: "planning",
          startDate: "2027-09-01",
          endDate: "2027-09-03",
          visibility: "private",
        },
      },
    );
    const body = await created.text();
    writeEvidence("optional-origin.json", {
      status: created.status(),
      body,
    });
    expect(created.status(), body).toBe(201);
    const trip = JSON.parse(body) as { id: string; origin: string };
    expect(trip.origin).toBe("未填写");

    const removed = await request.delete(`${STAGING_API_URL}/v1/trips/${trip.id}`, { headers });
    expect(removed.status(), await removed.text()).toBe(200);
  });

  test("rate limits cover auth, share reads, share password attempts, and upload presign", async ({
    request,
  }) => {
    const fixture = loadStagingFixture();
    const headers = authHeaders(fixture);
    const sessionStatuses: number[] = [];
    for (let index = 0; index < 15; index += 1) {
      const response = await request.get(`${STAGING_API_URL}/v1/auth/get-session`, {
        headers: clientHeaders(101, { origin: ALLOWED_ORIGIN }),
      });
      sessionStatuses.push(response.status());
    }

    const authStatuses: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const response = await request.post(`${STAGING_API_URL}/v1/auth/sign-in/email`, {
        headers: clientHeaders(102, { origin: ALLOWED_ORIGIN }),
        data: {
          email: `staging-rate-limit-${index}@roamlog.test`,
          password: "Definitely-Wrong-Aa1!",
        },
      });
      authStatuses.push(response.status());
    }

    const shareStatuses: number[] = [];
    for (let index = 0; index < 65; index += 1) {
      const token = `${(index + 160).toString(16)}${"b".repeat(41)}`;
      const response = await request.get(`${STAGING_API_URL}/v1/public/trips/${token}`, {
        headers: clientHeaders(103),
      });
      shareStatuses.push(response.status());
    }

    const passwordStatuses: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const response = await request.get(
        `${STAGING_API_URL}/v1/public/trips/${fixture.shares.password.token}?password=wrong-${index}`,
        { headers: clientHeaders(104) },
      );
      passwordStatuses.push(response.status());
    }

    const uploadStatuses: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const response = await request.post(
        `${STAGING_API_URL}/v1/workspaces/${fixture.web.workspace.id}/media/presign`,
        {
          headers: {
            ...headers,
            "x-forwarded-for": isolatedClientIp(105),
          },
          data: {
            fileName: `rate-limit-${index}.png`,
            mimeType: "image/png",
            size: 1_024,
          },
        },
      );
      uploadStatuses.push(response.status());
    }

    writeEvidence("rate-limit-probes.json", {
      authGetSession: sessionStatuses,
      auth: authStatuses,
      shareEnumeration: shareStatuses,
      sharePassword: passwordStatuses,
      uploadPresign: uploadStatuses,
      interpretation: {
        authGetSession429: sessionStatuses.includes(429),
        authExpects429: authStatuses.includes(429),
        shareExpects429: shareStatuses.includes(429),
        sharePasswordExpects429: passwordStatuses.includes(429),
        uploadExpects429: uploadStatuses.includes(429),
      },
    });

    expect.soft(authStatuses, "auth sign-in must be rate limited").toContain(429);
    expect.soft(shareStatuses, "share token reads must be rate limited").toContain(429);
    expect.soft(passwordStatuses, "share password attempts must be rate limited").toContain(429);
    expect.soft(uploadStatuses, "media presign must be rate limited").toContain(429);
    expect
      .soft(sessionStatuses, "normal session reads must not be rate limited")
      .not.toContain(429);
    expect
      .soft(authStatuses.slice(0, 10), "the auth mutation threshold is 10 per window")
      .not.toContain(429);
    expect.soft(authStatuses[10], "the 11th auth mutation must be rate limited").toBe(429);
    expect
      .soft(shareStatuses.slice(0, 60), "the first 60 share reads are allowed")
      .not.toContain(429);
    expect.soft(shareStatuses[60], "the 61st share read must be rate limited").toBe(429);
    expect
      .soft(passwordStatuses.slice(0, 20), "the first 20 password attempts are allowed")
      .not.toContain(429);
    expect.soft(passwordStatuses[20], "the 21st password attempt must be rate limited").toBe(429);
    expect
      .soft(uploadStatuses.slice(0, 20), "the first 20 upload presigns are allowed")
      .not.toContain(429);
    expect(uploadStatuses[20], "the 21st upload presign must be rate limited").toBe(429);
  });
});
